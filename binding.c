#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdlib.h>
#include <utf.h>
#include <uv.h>

typedef struct {
  uv_pipe_t pipe;
  uv_connect_t conn;
  uv_buf_t read_buf;
  uv_shutdown_t end;
  js_env_t *env;
  js_ref_t *ctx;
  js_ref_t *on_connect;
  js_ref_t *on_write;
  js_ref_t *on_end;
  js_ref_t *on_read;
  js_ref_t *on_close;
} bare_pipe_t;

typedef utf8_t bare_pipe_path_t[4096 + 1 /* NULL */];

static void
on_connect (uv_connect_t *req, int status) {
  int err;

  bare_pipe_t *self = (bare_pipe_t *) req->data;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, self->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_connect;
  err = js_get_reference_value(env, self->on_connect, &on_connect);
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

  js_call_function(env, ctx, on_connect, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
on_write (uv_write_t *req, int status) {
  int err;

  bare_pipe_t *self = (bare_pipe_t *) req->data;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, self->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_write;
  err = js_get_reference_value(env, self->on_write, &on_write);
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
on_shutdown (uv_shutdown_t *req, int status) {
  int err;

  bare_pipe_t *self = (bare_pipe_t *) req->data;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, self->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_end;
  err = js_get_reference_value(env, self->on_end, &on_end);
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
on_read (uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
  if (nread == UV_EOF) nread = 0;
  else if (nread == 0) return;

  int err;

  bare_pipe_t *self = (bare_pipe_t *) stream;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, self->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_read;
  err = js_get_reference_value(env, self->on_read, &on_read);
  assert(err == 0);

  js_value_t *argv[2];

  if (nread < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(nread), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(nread), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, 0, &argv[1]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, nread, &argv[1]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_read, 1, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
on_close (uv_handle_t *handle) {
  int err;

  bare_pipe_t *self = (bare_pipe_t *) handle;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, self->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_close;
  err = js_get_reference_value(env, self->on_close, &on_close);
  assert(err == 0);

  js_call_function(env, ctx, on_close, 0, NULL, NULL);

  err = js_delete_reference(env, self->on_connect);
  assert(err == 0);

  err = js_delete_reference(env, self->on_write);
  assert(err == 0);

  err = js_delete_reference(env, self->on_end);
  assert(err == 0);

  err = js_delete_reference(env, self->on_read);
  assert(err == 0);

  err = js_delete_reference(env, self->on_close);
  assert(err == 0);

  err = js_delete_reference(env, self->ctx);
  assert(err == 0);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
on_alloc (uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  bare_pipe_t *self = (bare_pipe_t *) handle;
  *buf = self->read_buf;
}

static js_value_t *
bare_pipe_init (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 8;
  js_value_t *argv[8];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 8);

  uv_loop_t *loop;
  js_get_env_loop(env, &loop);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  err = uv_pipe_init(loop, &self->pipe, 0);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  size_t read_buf_len;
  char *read_buf;
  err = js_get_typedarray_info(env, argv[1], NULL, (void **) &read_buf, &read_buf_len, NULL, NULL);
  assert(err == 0);

  self->env = env;

  self->read_buf = uv_buf_init(read_buf, read_buf_len);

  err = js_create_reference(env, argv[2], 1, &self->ctx);
  assert(err == 0);

  err = js_create_reference(env, argv[3], 1, &self->on_connect);
  assert(err == 0);

  err = js_create_reference(env, argv[4], 1, &self->on_write);
  assert(err == 0);

  err = js_create_reference(env, argv[5], 1, &self->on_end);
  assert(err == 0);

  err = js_create_reference(env, argv[6], 1, &self->on_read);
  assert(err == 0);

  err = js_create_reference(env, argv[7], 1, &self->on_close);
  assert(err == 0);

  return NULL;
}

static js_value_t *
bare_pipe_connect (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  bare_pipe_path_t path;
  err = js_get_value_string_utf8(env, argv[1], path, sizeof(bare_pipe_path_t), NULL);
  assert(err == 0);

  uv_connect_t *conn = &self->conn;

  conn->data = self;

  uv_pipe_connect(conn, &self->pipe, (char *) path, on_connect);

  return NULL;
}

static js_value_t *
bare_pipe_open (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  uint32_t fd;
  err = js_get_value_uint32(env, argv[1], &fd);
  assert(err == 0);

  err = uv_pipe_open(&self->pipe, fd);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
bare_pipe_writev (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 3);

  uv_write_t *req;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &req, NULL, NULL, NULL);
  assert(err == 0);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[1], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  js_value_t *arr = argv[2];
  js_value_t *item;

  uint32_t bufs_len;
  err = js_get_array_length(env, arr, &bufs_len);
  assert(err == 0);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * bufs_len);

  for (uint32_t i = 0; i < bufs_len; i++) {
    err = js_get_element(env, arr, i, &item);
    assert(err == 0);

    uv_buf_t *buf = &bufs[i];
    err = js_get_typedarray_info(env, item, NULL, (void **) &buf->base, &buf->len, NULL, NULL);
    assert(err == 0);
  }

  req->data = self;

  err = uv_write(req, (uv_stream_t *) &self->pipe, bufs, bufs_len, on_write);

  free(bufs);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
bare_pipe_end (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  uv_shutdown_t *req = &self->end;

  req->data = self;

  err = uv_shutdown(req, (uv_stream_t *) self, on_shutdown);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
bare_pipe_resume (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  err = uv_read_start((uv_stream_t *) &self->pipe, on_alloc, on_read);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
bare_pipe_pause (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  err = uv_read_stop((uv_stream_t *) &self->pipe);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
bare_pipe_close (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_pipe_t *self;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
  assert(err == 0);

  uv_close((uv_handle_t *) &self->pipe, on_close);

  return NULL;
}

static js_value_t *
init (js_env_t *env, js_value_t *exports) {
  {
    js_value_t *val;
    js_create_uint32(env, sizeof(bare_pipe_t), &val);
    js_set_named_property(env, exports, "sizeofPipe", val);
  }
  {
    js_value_t *val;
    js_create_uint32(env, sizeof(uv_write_t), &val);
    js_set_named_property(env, exports, "sizeofWrite", val);
  }
  {
    js_value_t *fn;
    js_create_function(env, "init", -1, bare_pipe_init, NULL, &fn);
    js_set_named_property(env, exports, "init", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "connect", -1, bare_pipe_connect, NULL, &fn);
    js_set_named_property(env, exports, "connect", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "open", -1, bare_pipe_open, NULL, &fn);
    js_set_named_property(env, exports, "open", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "writev", -1, bare_pipe_writev, NULL, &fn);
    js_set_named_property(env, exports, "writev", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "end", -1, bare_pipe_end, NULL, &fn);
    js_set_named_property(env, exports, "end", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "resume", -1, bare_pipe_resume, NULL, &fn);
    js_set_named_property(env, exports, "resume", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "pause", -1, bare_pipe_pause, NULL, &fn);
    js_set_named_property(env, exports, "pause", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "close", -1, bare_pipe_close, NULL, &fn);
    js_set_named_property(env, exports, "close", fn);
  }

  return exports;
}

BARE_MODULE(bare_pipe, init)
