#ifdef __linux__
#define _GNU_SOURCE
#endif

#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <utf.h>
#include <uv.h>

#ifdef _WIN32
#include <aclapi.h>
#include <sddl.h>
#include <stdio.h>
#include <windns.h>
#else
#include <errno.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __APPLE__
#include <sys/un.h>
#endif
#endif

typedef utf8_t bare_pipe_path_t[4096 + 1 /* NULL */];

typedef struct {
  int64_t pid;
  int64_t uid;
  int64_t gid;
  char *sid;
} bare_pipe_credentials_t;

typedef struct {
  uv_pipe_t handle;

  struct {
    uv_connect_t connect;
    uv_write_t write;
    uv_shutdown_t shutdown;
  } requests;

  uv_buf_t read;

  js_env_t *env;
  js_ref_t *ctx;
  js_ref_t *on_connection;
  js_ref_t *on_connect;
  js_ref_t *on_read;
  js_ref_t *on_write;
  js_ref_t *on_end;
  js_ref_t *on_handle;
  js_ref_t *on_close;

  bool closing;
  bool exiting;

#ifdef _WIN32
  FILETIME connected;
#endif

  js_deferred_teardown_t *teardown;
} bare_pipe_t;

enum {
  bare_pipe_readable = 0x1,
  bare_pipe_writable = 0x2
};

static inline int
bare_pipe__get_path(js_env_t *env, js_value_t *value, utf8_t *str, size_t len, size_t *result) {
  int err;

  size_t written;
  err = js_get_value_string_utf8(env, value, str, len, &written);
  assert(err == 0);

  if (written == len) {
    err = js_throw_error(env, uv_err_name(UV_ENAMETOOLONG), uv_strerror(UV_ENAMETOOLONG));
    assert(err == 0);

    return -1;
  }

  *result = written;

  return 0;
}

static inline int
bare_pipe__buffers(js_env_t *env, js_value_t *value, uv_buf_t **result, uint32_t *len) {
  int err;

  uint32_t bufs_len;
  err = js_get_array_length(env, value, &bufs_len);
  assert(err == 0);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * bufs_len);

  js_value_t **elements = malloc(sizeof(js_value_t *) * bufs_len);

  if ((bufs == NULL || elements == NULL) && bufs_len > 0) {
    free(bufs);
    free(elements);

    err = js_throw_error(env, uv_err_name(UV_ENOMEM), uv_strerror(UV_ENOMEM));
    assert(err == 0);

    return -1;
  }

  err = js_get_array_elements(env, value, elements, bufs_len, 0, NULL);
  assert(err == 0);

  for (uint32_t i = 0; i < bufs_len; i++) {
    uv_buf_t *buf = &bufs[i];

    size_t buf_len;
    err = js_get_typedarray_info(env, elements[i], NULL, (void **) &buf->base, &buf_len, NULL, NULL);
    assert(err == 0);

    buf->len = buf_len;
  }

  free(elements);

  *result = bufs;
  *len = bufs_len;

  return 0;
}

static inline bool
bare_pipe__is_handle(js_env_t *env, js_value_t *value, uv_loop_t *loop, uv_stream_t **result) {
  int err;

  bool is_arraybuffer;
  err = js_is_arraybuffer(env, value, &is_arraybuffer);
  assert(err == 0);

  if (!is_arraybuffer) return false;

  void *data;
  size_t len;
  err = js_get_arraybuffer_info(env, value, &data, &len);
  assert(err == 0);

  if (len < sizeof(uv_handle_t)) return false;

  uv_handle_t *handle = (uv_handle_t *) data;

  if (uv_handle_get_loop(handle) != loop) return false;

  switch (uv_handle_get_type(handle)) {
  case UV_NAMED_PIPE:
    if (len < sizeof(uv_pipe_t)) return false;
    break;

  case UV_TCP:
    if (len < sizeof(uv_tcp_t)) return false;
    break;

  case UV_UDP:
    if (len < sizeof(uv_udp_t)) return false;
    break;

  default:
    return false;
  }

  *result = (uv_stream_t *) data;

  return true;
}

#ifdef _WIN32

static int
bare_pipe__token_sid(HANDLE token, char **result) {
  DWORD len = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &len);

  DWORD error = GetLastError();
  if (error != ERROR_INSUFFICIENT_BUFFER) return uv_translate_sys_error(error);

  TOKEN_USER *user = malloc(len);
  if (user == NULL) return UV_ENOMEM;

  int err = 0;

  if (!GetTokenInformation(token, TokenUser, user, len, &len)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (!ConvertSidToStringSidA(user->User.Sid, result)) {
    err = uv_translate_sys_error(GetLastError());
  }

  free(user);

  return err;
}

static int
bare_pipe__process_sid(DWORD pid, const FILETIME *connected, char **result) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == NULL) return uv_translate_sys_error(GetLastError());

  int err = 0;

  FILETIME created, exited, kernel, user;
  HANDLE token = NULL;

  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
    err = uv_translate_sys_error(GetLastError());
  } else if (CompareFileTime(&created, connected) > 0) {
    // The peer was alive when the pipe connected, so a process created since
    // has reused its ID after it exited.
    err = UV_ESRCH;
  } else if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    err = uv_translate_sys_error(GetLastError());
  }

  CloseHandle(process);

  if (err < 0) return err;

  err = bare_pipe__token_sid(token, result);

  CloseHandle(token);

  return err;
}

static inline void
bare_pipe__mark_connected(bare_pipe_t *pipe) {
  GetSystemTimePreciseAsFileTime(&pipe->connected);
}

static int
bare_pipe__restrict_to_owner(uv_pipe_t *handle) {
  HANDLE token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    return uv_translate_sys_error(GetLastError());
  }

  char *sid;
  int err = bare_pipe__token_sid(token, &sid);

  CloseHandle(token);

  if (err < 0) return err;

  // Protected, so nothing is inherited: the current user and SYSTEM are
  // allowed, and network logons are denied even for the current user, which
  // stands in for PIPE_REJECT_REMOTE_CLIENTS that libuv does not set.
  const char *format = "D:P(D;;GA;;;NU)(A;;GA;;;%s)(A;;GA;;;SY)";

  size_t len = snprintf(NULL, 0, format, sid) + 1 /* NULL */;

  char *sddl = malloc(len);

  if (sddl == NULL) {
    LocalFree(sid);

    return UV_ENOMEM;
  }

  snprintf(sddl, len, format, sid);

  LocalFree(sid);

  PSECURITY_DESCRIPTOR sd;
  BOOL ok = ConvertStringSecurityDescriptorToSecurityDescriptorA(sddl, SDDL_REVISION_1, &sd, NULL);
  DWORD error = GetLastError();

  free(sddl);

  if (!ok) return uv_translate_sys_error(error);

  BOOL present, defaulted;
  PACL dacl;
  if (!GetSecurityDescriptorDacl(sd, &present, &dacl, &defaulted)) {
    err = uv_translate_sys_error(GetLastError());
  } else {
    // The descriptor lives on the pipe, not the instance: libuv's own
    // uv_pipe_chmod() relies on the same handle to change every instance.
    error = SetSecurityInfo(handle->handle, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, NULL, NULL, dacl, NULL);

    if (error != ERROR_SUCCESS) err = uv_translate_sys_error(error);
  }

  LocalFree(sd);

  if (err < 0) return err;

  // The first instance exists from bind, and a client that opened it before
  // the DACL changed keeps its connection. Drop it before listen accepts it.
  if (!DisconnectNamedPipe(handle->handle)) {
    error = GetLastError();

    if (error != ERROR_PIPE_NOT_CONNECTED) return uv_translate_sys_error(error);
  }

  return 0;
}

static bool
bare_pipe__is_local_name(const WCHAR *name) {
  return name != NULL && (_wcsnicmp(name, L"\\\\.\\pipe\\", 9) == 0 || _wcsnicmp(name, L"\\\\?\\pipe\\", 9) == 0);
}

static int
bare_pipe__peer_credentials(bare_pipe_t *pipe, bare_pipe_credentials_t *result) {
  HANDLE handle = pipe->handle.handle;

  DWORD flags;
  if (!GetNamedPipeInfo(handle, &flags, NULL, NULL, NULL)) return uv_translate_sys_error(GetLastError());

  ULONG pid;

  // A remote peer's process ID names a process on another machine, so it is
  // never reported, and neither is anything derived from it.
  if (flags & PIPE_SERVER_END) {
    WCHAR host[DNS_MAX_NAME_BUFFER_LENGTH];
    if (GetNamedPipeClientComputerNameW(handle, host, sizeof(host))) return 0;

    DWORD error = GetLastError();
    if (error != ERROR_PIPE_LOCAL) return uv_translate_sys_error(error);

    if (!GetNamedPipeClientProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());
  } else {
    // Only a pipe connected by a local name is known to have a local server.
    if (!bare_pipe__is_local_name(pipe->handle.name)) return 0;

    if (!GetNamedPipeServerProcessId(handle, &pid)) return uv_translate_sys_error(GetLastError());
  }

  result->pid = pid;

  // A peer whose token the caller may not query, such as an elevated process
  // seen from an unelevated one, or whose ID has been reused, reports no SID
  // rather than failing.
  if (bare_pipe__process_sid(pid, &pipe->connected, &result->sid) < 0) result->sid = NULL;

  return 0;
}

#else

static int
bare_pipe__restrict_to_owner(uv_pipe_t *handle) {
  bare_pipe_path_t path;
  size_t path_len = sizeof(path);

  int err = uv_pipe_getsockname(handle, (char *) path, &path_len);
  if (err < 0) return err;

  if (chmod((char *) path, S_IRUSR | S_IWUSR) != 0) return uv_translate_sys_error(errno);

  return 0;
}

static inline void
bare_pipe__mark_connected(bare_pipe_t *pipe) {}

#ifdef __linux__

static int
bare_pipe__peer_credentials(bare_pipe_t *pipe, bare_pipe_credentials_t *result) {
  uv_os_fd_t fd;
  int err = uv_fileno((uv_handle_t *) &pipe->handle, &fd);
  if (err < 0) return err;

  struct ucred cred;
  socklen_t len = sizeof(cred);

  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return uv_translate_sys_error(errno);

  result->pid = cred.pid;
  result->uid = cred.uid;
  result->gid = cred.gid;

  return 0;
}

#else

static int
bare_pipe__peer_credentials(bare_pipe_t *pipe, bare_pipe_credentials_t *result) {
  uv_os_fd_t fd;
  int err = uv_fileno((uv_handle_t *) &pipe->handle, &fd);
  if (err < 0) return err;

  uid_t uid;
  gid_t gid;

  if (getpeereid(fd, &uid, &gid) != 0) return uv_translate_sys_error(errno);

  result->uid = uid;
  result->gid = gid;

#ifdef __APPLE__
  pid_t pid;
  socklen_t len = sizeof(pid);

  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &len) == 0) result->pid = pid;
#endif

  return 0;
}

#endif

#endif

static void
bare_pipe__on_connection(uv_stream_t *server, int status) {
  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) server;

  if (pipe->closing || pipe->exiting) return;

  js_env_t *env = pipe->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_connection;
  err = js_get_reference_value(env, pipe->on_connection, &on_connection);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_connection, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_pipe__on_connect(uv_connect_t *req, int status) {
  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) req->data;

  if (pipe->closing || pipe->exiting) return;

  js_env_t *env = pipe->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_connect;
  err = js_get_reference_value(env, pipe->on_connect, &on_connect);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    bare_pipe__mark_connected(pipe);

    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_connect, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_pipe__on_read(uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
  if (nread == UV_EOF) nread = 0;
  else if (nread == 0) return;

  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) stream;

  if (pipe->exiting) return;

  js_env_t *env = pipe->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  // Handles arrive alongside the data that was read, so they are surfaced first
  // and in arrival order. A listener that doesn't accept the pending handle
  // would leave it queued forever, so the loop stops making progress rather
  // than spinning.
  size_t pending = uv_pipe_pending_count((uv_pipe_t *) stream);

  while (pending > 0 && !pipe->closing && !pipe->exiting) {
    uv_handle_type type = uv_pipe_pending_type((uv_pipe_t *) stream);

    js_value_t *on_handle;
    err = js_get_reference_value(env, pipe->on_handle, &on_handle);
    assert(err == 0);

    js_value_t *argv[1];
    err = js_create_uint32(env, (uint32_t) type, &argv[0]);
    assert(err == 0);

    js_call_function(env, ctx, on_handle, 1, argv, NULL);

    size_t next = uv_pipe_pending_count((uv_pipe_t *) stream);

    if (next >= pending) break;

    pending = next;
  }

  if (pipe->closing || pipe->exiting) {
    err = js_close_handle_scope(env, scope);
    assert(err == 0);

    return;
  }

  js_value_t *on_read;
  err = js_get_reference_value(env, pipe->on_read, &on_read);
  assert(err == 0);

  js_value_t *argv[2];

  if (nread < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name((int) nread), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror((int) nread), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, 0, &argv[1]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, (int32_t) nread, &argv[1]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_read, 2, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_pipe__on_write(uv_write_t *req, int status) {
  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) req->data;

  if (pipe->exiting) return;

  js_env_t *env = pipe->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_write;
  err = js_get_reference_value(env, pipe->on_write, &on_write);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_write, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_pipe__on_shutdown(uv_shutdown_t *req, int status) {
  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) req->data;

  if (pipe->exiting) return;

  js_env_t *env = pipe->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_end;
  err = js_get_reference_value(env, pipe->on_end, &on_end);
  assert(err == 0);

  js_value_t *argv[1];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_end, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_pipe__on_close(uv_handle_t *handle) {
  int err;

  bare_pipe_t *pipe = (bare_pipe_t *) handle;

  js_env_t *env = pipe->env;

  js_deferred_teardown_t *teardown = pipe->teardown;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, pipe->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_close;
  err = js_get_reference_value(env, pipe->on_close, &on_close);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_connection);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_connect);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_read);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_write);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_end);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_handle);
  assert(err == 0);

  err = js_delete_reference(env, pipe->on_close);
  assert(err == 0);

  err = js_delete_reference(env, pipe->ctx);
  assert(err == 0);

  if (!pipe->exiting) js_call_function(env, ctx, on_close, 0, NULL, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  err = js_finish_deferred_teardown_callback(teardown);
  assert(err == 0);
}

static void
bare_pipe__on_teardown(js_deferred_teardown_t *handle, void *data) {
  bare_pipe_t *pipe = (bare_pipe_t *) data;

  pipe->exiting = true;

  if (pipe->closing) return;

  uv_close((uv_handle_t *) &pipe->handle, bare_pipe__on_close);
}

static void
bare_pipe__on_alloc(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  bare_pipe_t *pipe = (bare_pipe_t *) handle;

  *buf = pipe->read;
}

static js_value_t *
bare_pipe_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 10;
  js_value_t *argv[10];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 10);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  js_value_t *handle;

  bare_pipe_t *pipe;
  err = js_create_arraybuffer(env, sizeof(bare_pipe_t), (void **) &pipe, &handle);
  assert(err == 0);

  bool ipc;
  err = js_get_value_bool(env, argv[1], &ipc);
  assert(err == 0);

  err = uv_pipe_init(loop, &pipe->handle, ipc);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  pipe->env = env;
  pipe->closing = false;
  pipe->exiting = false;

  // An accepted pipe is initialized only once its client has connected.
  bare_pipe__mark_connected(pipe);

  size_t read_len;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &pipe->read.base, &read_len, NULL, NULL);
  assert(err == 0);

  pipe->read.len = read_len;

  err = js_create_reference(env, argv[2], 1, &pipe->ctx);
  assert(err == 0);

  err = js_create_reference(env, argv[3], 1, &pipe->on_connection);
  assert(err == 0);

  err = js_create_reference(env, argv[4], 1, &pipe->on_connect);
  assert(err == 0);

  err = js_create_reference(env, argv[5], 1, &pipe->on_read);
  assert(err == 0);

  err = js_create_reference(env, argv[6], 1, &pipe->on_write);
  assert(err == 0);

  err = js_create_reference(env, argv[7], 1, &pipe->on_end);
  assert(err == 0);

  err = js_create_reference(env, argv[8], 1, &pipe->on_handle);
  assert(err == 0);

  err = js_create_reference(env, argv[9], 1, &pipe->on_close);
  assert(err == 0);

  err = js_add_deferred_teardown_callback(env, bare_pipe__on_teardown, (void *) pipe, &pipe->teardown);
  assert(err == 0);

  return handle;
}

static js_value_t *
bare_pipe_connect(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  bare_pipe_path_t path;
  size_t path_len;
  if (bare_pipe__get_path(env, argv[1], path, sizeof(path), &path_len) < 0) return NULL;

  uv_connect_t *req = &pipe->requests.connect;

  req->data = pipe;

  err = uv_pipe_connect2(req, &pipe->handle, (char *) path, path_len, UV_PIPE_NO_TRUNCATE, bare_pipe__on_connect);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_bind(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 4;
  js_value_t *argv[4];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 4);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  bare_pipe_path_t path;
  size_t path_len;
  if (bare_pipe__get_path(env, argv[1], path, sizeof(path), &path_len) < 0) return NULL;

  uint32_t backlog;
  err = js_get_value_uint32(env, argv[2], &backlog);
  assert(err == 0);

  bool owner_only;
  err = js_get_value_bool(env, argv[3], &owner_only);
  assert(err == 0);

  err = uv_pipe_bind2(&pipe->handle, (char *) path, path_len, UV_PIPE_NO_TRUNCATE);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  // Restricted before listen, so that no connection is ever accepted under the
  // default access rights.
  if (owner_only) {
    err = bare_pipe__restrict_to_owner(&pipe->handle);

    if (err < 0) {
      err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
      assert(err == 0);

      return NULL;
    }
  }

  err = uv_listen((uv_stream_t *) &pipe->handle, (int) backlog, bare_pipe__on_connection);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  int32_t fd;
  err = js_get_value_int32(env, argv[1], &fd);
  assert(err == 0);

  uv_handle_type type = uv_guess_handle((uv_file) fd);

  if (type == UV_FILE || type == UV_UNKNOWN_HANDLE) {
    uv_fs_t req;
    err = uv_fs_fstat(NULL, &req, (uv_file) fd, NULL);

    uv_fs_req_cleanup(&req);

    if (err >= 0) err = UV_EINVAL;

    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  err = uv_pipe_open(&pipe->handle, (uv_file) fd);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  bare_pipe__mark_connected(pipe);

  uint32_t status = 0;

  if (uv_is_readable((uv_stream_t *) &pipe->handle)) status |= bare_pipe_readable;
  if (uv_is_writable((uv_stream_t *) &pipe->handle)) status |= bare_pipe_writable;

  js_value_t *result;
  err = js_create_uint32(env, status, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_pipe_accept(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  bare_pipe_t *server;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &server, NULL);
  assert(err == 0);

  uv_stream_t *client;

  if (!bare_pipe__is_handle(env, argv[1], loop, &client)) {
    err = js_throw_error(env, uv_err_name(UV_EINVAL), uv_strerror(UV_EINVAL));
    assert(err == 0);

    return NULL;
  }

  err = uv_accept((uv_stream_t *) &server->handle, client);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_resume(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  if (!uv_is_readable((uv_stream_t *) &pipe->handle)) return NULL;

  err = uv_read_start((uv_stream_t *) &pipe->handle, bare_pipe__on_alloc, bare_pipe__on_read);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_pause(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  if (!uv_is_readable((uv_stream_t *) &pipe->handle)) return NULL;

  err = uv_read_stop((uv_stream_t *) &pipe->handle);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_writev(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 3);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  // A write either carries a handle or it doesn't, so the target is resolved
  // before anything is allocated.
  uv_stream_t *send_handle = NULL;

  js_value_type_t send_handle_type;
  err = js_typeof(env, argv[2], &send_handle_type);
  assert(err == 0);

  if (send_handle_type != js_null && send_handle_type != js_undefined) {
    uv_loop_t *loop;
    err = js_get_env_loop(env, &loop);
    assert(err == 0);

    if (!bare_pipe__is_handle(env, argv[2], loop, &send_handle)) {
      err = js_throw_error(env, uv_err_name(UV_EINVAL), uv_strerror(UV_EINVAL));
      assert(err == 0);

      return NULL;
    }
  }

  uv_buf_t *bufs;
  uint32_t bufs_len;
  if (bare_pipe__buffers(env, argv[1], &bufs, &bufs_len) < 0) return NULL;

  uv_write_t *req = &pipe->requests.write;

  req->data = pipe;

  if (send_handle == NULL) {
    err = uv_write(req, (uv_stream_t *) &pipe->handle, bufs, bufs_len, bare_pipe__on_write);
  } else {
    err = uv_write2(req, (uv_stream_t *) &pipe->handle, bufs, bufs_len, send_handle, bare_pipe__on_write);
  }

  free(bufs);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_end(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  uv_shutdown_t *req = &pipe->requests.shutdown;

  req->data = pipe;

  err = uv_shutdown(req, (uv_stream_t *) &pipe->handle, bare_pipe__on_shutdown);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_pipe_close(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  if (pipe->closing) return NULL;

  pipe->closing = true;

  uv_close((uv_handle_t *) &pipe->handle, bare_pipe__on_close);

  return NULL;
}

static js_value_t *
bare_pipe_ref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  uv_ref((uv_handle_t *) &pipe->handle);

  return NULL;
}

static js_value_t *
bare_pipe_unref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  uv_unref((uv_handle_t *) &pipe->handle);

  return NULL;
}

static inline void
bare_pipe__set_id(js_env_t *env, js_value_t *object, const char *name, int64_t id) {
  int err;

  js_value_t *val;

  if (id < 0) err = js_get_null(env, &val);
  else err = js_create_int64(env, id, &val);
  assert(err == 0);

  err = js_set_named_property(env, object, name, val);
  assert(err == 0);
}

static js_value_t *
bare_pipe_remote_credentials(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *pipe;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &pipe, NULL);
  assert(err == 0);

  bare_pipe_credentials_t credentials = {-1, -1, -1, NULL};

  err = bare_pipe__peer_credentials(pipe, &credentials);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_object(env, &result);
  assert(err == 0);

  bare_pipe__set_id(env, result, "pid", credentials.pid);
  bare_pipe__set_id(env, result, "uid", credentials.uid);
  bare_pipe__set_id(env, result, "gid", credentials.gid);

  js_value_t *sid;

  if (credentials.sid == NULL) err = js_get_null(env, &sid);
  else err = js_create_string_utf8(env, (utf8_t *) credentials.sid, -1, &sid);
  assert(err == 0);

  err = js_set_named_property(env, result, "sid", sid);
  assert(err == 0);

#ifdef _WIN32
  if (credentials.sid != NULL) LocalFree(credentials.sid);
#endif

  return result;
}

static js_value_t *
bare_pipe_pipe(js_env_t *env, js_callback_info_t *info) {
  int err;

  uv_file fds[2];
  err = uv_pipe(fds, UV_NONBLOCK_PIPE, UV_NONBLOCK_PIPE);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_array_with_length(env, 2, &result);
  assert(err == 0);

  js_value_t *first;
  err = js_create_int32(env, fds[0], &first);
  assert(err == 0);

  js_value_t *second;
  err = js_create_int32(env, fds[1], &second);
  assert(err == 0);

  err = js_set_element(env, result, 0, first);
  assert(err == 0);

  err = js_set_element(env, result, 1, second);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_pipe_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("init", bare_pipe_init)
  V("connect", bare_pipe_connect)
  V("bind", bare_pipe_bind)
  V("open", bare_pipe_open)
  V("accept", bare_pipe_accept)
  V("resume", bare_pipe_resume)
  V("pause", bare_pipe_pause)
  V("writev", bare_pipe_writev)
  V("end", bare_pipe_end)
  V("close", bare_pipe_close)
  V("ref", bare_pipe_ref)
  V("unref", bare_pipe_unref)
  V("pipe", bare_pipe_pipe)
  V("remoteCredentials", bare_pipe_remote_credentials)
#undef V

#define V(name, n) \
  { \
    js_value_t *val; \
    err = js_create_uint32(env, n, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("READABLE", bare_pipe_readable)
  V("WRITABLE", bare_pipe_writable)

  V("MAX_PATH_LENGTH", sizeof(bare_pipe_path_t) - 1 /* NULL */)

  V("UV_NAMED_PIPE", UV_NAMED_PIPE)
  V("UV_TCP", UV_TCP)
  V("UV_UDP", UV_UDP)
#undef V

  return exports;
}

BARE_MODULE(bare_pipe, bare_pipe_exports)
