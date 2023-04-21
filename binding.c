#include <js.h>
#include <pear.h>
#include <stdlib.h>
#include <uv.h>

typedef struct {
  uv_pipe_t pipe;
  uv_tty_t tty_pipe;
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
} pear_pipe_t;

static void
on_connect (uv_connect_t *req, int status) {
  pear_pipe_t *self = (pear_pipe_t *) req->data;
  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  js_open_handle_scope(env, &scope);

  js_value_t *ctx;
  js_get_reference_value(env, self->ctx, &ctx);
  js_value_t *callback;
  js_get_reference_value(env, self->on_connect, &callback);
  js_value_t *argv[1];
  js_create_int32(env, status, &argv[0]);

  js_call_function(env, ctx, callback, 1, argv, NULL);

  js_close_handle_scope(env, scope);
}

static void
on_write (uv_write_t *req, int status) {
  pear_pipe_t *self = (pear_pipe_t *) req->data;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  js_open_handle_scope(env, &scope);

  js_value_t *ctx;
  js_get_reference_value(env, self->ctx, &ctx);
  js_value_t *callback;
  js_get_reference_value(env, self->on_write, &callback);
  js_value_t *argv[1];
  js_create_int32(env, status, &argv[0]);

  js_call_function(env, ctx, callback, 1, argv, NULL);

  js_close_handle_scope(env, scope);
}

static void
on_shutdown (uv_shutdown_t *req, int status) {
  pear_pipe_t *self = (pear_pipe_t *) req->data;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  js_open_handle_scope(env, &scope);

  js_value_t *ctx;
  js_get_reference_value(env, self->ctx, &ctx);
  js_value_t *callback;
  js_get_reference_value(env, self->on_end, &callback);
  js_value_t *argv[1];
  js_create_int32(env, status, &argv[0]);

  js_call_function(env, ctx, callback, 1, argv, NULL);

  js_close_handle_scope(env, scope);
}

static void
on_read (uv_stream_t *stream, ssize_t nread, const uv_buf_t *buf) {
  if (nread == UV_EOF) nread = 0;
  else if (nread == 0) return;

  pear_pipe_t *self = (pear_pipe_t *) stream;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  js_open_handle_scope(env, &scope);

  js_value_t *ctx;
  js_get_reference_value(env, self->ctx, &ctx);
  js_value_t *callback;
  js_get_reference_value(env, self->on_read, &callback);
  js_value_t *argv[1];
  js_create_int32(env, nread, &argv[0]);

  js_call_function(env, ctx, callback, 1, argv, NULL);

  js_close_handle_scope(env, scope);
}

static void
on_close (uv_handle_t *handle) {
  pear_pipe_t *self = (pear_pipe_t *) handle;

  js_env_t *env = self->env;

  js_handle_scope_t *scope;
  js_open_handle_scope(env, &scope);

  js_value_t *ctx;
  js_get_reference_value(env, self->ctx, &ctx);
  js_value_t *callback;
  js_get_reference_value(env, self->on_close, &callback);

  js_call_function(env, ctx, callback, 0, NULL, NULL);

  js_close_handle_scope(env, scope);

  js_delete_reference(env, self->on_connect);
  js_delete_reference(env, self->on_write);
  js_delete_reference(env, self->on_end);
  js_delete_reference(env, self->on_read);
  js_delete_reference(env, self->on_close);
  js_delete_reference(env, self->ctx);
}

static void
on_alloc (uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  pear_pipe_t *self = (pear_pipe_t *) handle;
  *buf = self->read_buf;
}

static js_value_t *
pear_pipe_init (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 9;
  js_value_t *argv[9];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uv_loop_t *loop;
  js_get_env_loop(env, &loop);

  bool is_tty;
  js_get_value_bool(env, argv[3], &is_tty);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  if (is_tty) {
    js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);
    uv_tty_init(loop, &self->tty_pipe, 0, 1);
    uv_tty_set_mode(&self->tty_pipe, UV_TTY_MODE_RAW);
  } else {
    uv_pipe_init(loop, &self->pipe, 0);
  }

  size_t read_buf_len;
  char *read_buf;
  js_get_typedarray_info(env, argv[1], NULL, (void **) &read_buf, &read_buf_len, NULL, NULL);

  self->read_buf = uv_buf_init(read_buf, read_buf_len);

  js_create_reference(env, argv[2], 1, &self->ctx);
  js_create_reference(env, argv[4], 1, &self->on_connect);
  js_create_reference(env, argv[5], 1, &self->on_write);
  js_create_reference(env, argv[6], 1, &self->on_end);
  js_create_reference(env, argv[7], 1, &self->on_read);
  js_create_reference(env, argv[8], 1, &self->on_close);

  self->env = env;

  return NULL;
}

static js_value_t *
pear_pipe_connect (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  size_t path_len = 4096;
  char path[4096];
  js_get_value_string_utf8(env, argv[1], path, path_len, &path_len);

  uv_connect_t *conn = &self->conn;

  conn->data = self;

  uv_pipe_connect(conn, &self->pipe, path, on_connect);

  return NULL;
}

static js_value_t *
pear_pipe_open (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 3;
  js_value_t *argv[3];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  uint32_t fd;
  js_get_value_uint32(env, argv[1], &fd);

  bool is_tty;
  js_get_value_bool(env, argv[2], &is_tty);

  if (!is_tty) {
    uv_pipe_open(&self->pipe, fd);
  }

  return NULL;
}

static js_value_t *
pear_pipe_writev (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 4;
  js_value_t *argv[4];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uv_write_t *req;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &req, NULL, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[1], NULL, (void **) &self, NULL, NULL, NULL);

  js_value_t *arr = argv[2];
  js_value_t *item;

  uint32_t nbufs;
  js_get_array_length(env, arr, &nbufs);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * nbufs);

  for (uint32_t i = 0; i < nbufs; i++) {
    js_get_element(env, arr, i, &item);

    uv_buf_t *buf = &bufs[i];
    js_get_typedarray_info(env, item, NULL, (void **) &buf->base, &buf->len, NULL, NULL);
  }

  req->data = self;

  bool is_tty;
  js_get_value_bool(env, argv[3], &is_tty);

  int err;

  if (is_tty) {
    err = uv_write(req, (uv_stream_t *) &self->tty_pipe, bufs, nbufs, on_write);
  } else {
    err = uv_write(req, (uv_stream_t *) &self->pipe, bufs, nbufs, on_write);
  }

  free(bufs);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
pear_pipe_end (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 1;
  js_value_t *argv[1];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  uv_shutdown_t *req = &self->end;

  req->data = self;

  int err = uv_shutdown(req, (uv_stream_t *) self, on_shutdown);

  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
pear_pipe_resume (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  bool is_tty;
  js_get_value_bool(env, argv[1], &is_tty);

  if (is_tty) {
    uv_read_start((uv_stream_t *) &self->tty_pipe, on_alloc, on_read);
  } else {
    uv_read_start((uv_stream_t *) &self->pipe, on_alloc, on_read);
  }

  return NULL;
}

static js_value_t *
pear_pipe_pause (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  bool is_tty;
  js_get_value_bool(env, argv[1], &is_tty);

  if (is_tty) {
    uv_read_stop((uv_stream_t *) &self->tty_pipe);
  } else {
    uv_read_stop((uv_stream_t *) &self->pipe);
  }

  return NULL;
}

static js_value_t *
pear_pipe_close (js_env_t *env, js_callback_info_t *info) {
  size_t argc = 2;
  js_value_t *argv[2];

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  pear_pipe_t *self;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &self, NULL, NULL, NULL);

  bool is_tty;
  js_get_value_bool(env, argv[1], &is_tty);

  if (is_tty) {
    uv_close((uv_handle_t *) &self->tty_pipe, on_close);
  } else {
    uv_close((uv_handle_t *) &self->pipe, on_close);
  }

  return NULL;
}

static js_value_t *
init (js_env_t *env, js_value_t *exports) {
  {
    js_value_t *val;
    js_create_uint32(env, sizeof(pear_pipe_t), &val);
    js_set_named_property(env, exports, "sizeofPipe", val);
  }
  {
    js_value_t *val;
    js_create_uint32(env, sizeof(uv_write_t), &val);
    js_set_named_property(env, exports, "sizeofWrite", val);
  }
  {
    js_value_t *fn;
    js_create_function(env, "init", -1, pear_pipe_init, NULL, &fn);
    js_set_named_property(env, exports, "init", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "connect", -1, pear_pipe_connect, NULL, &fn);
    js_set_named_property(env, exports, "connect", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "open", -1, pear_pipe_open, NULL, &fn);
    js_set_named_property(env, exports, "open", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "writev", -1, pear_pipe_writev, NULL, &fn);
    js_set_named_property(env, exports, "writev", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "end", -1, pear_pipe_end, NULL, &fn);
    js_set_named_property(env, exports, "end", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "resume", -1, pear_pipe_resume, NULL, &fn);
    js_set_named_property(env, exports, "resume", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "pause", -1, pear_pipe_pause, NULL, &fn);
    js_set_named_property(env, exports, "pause", fn);
  }
  {
    js_value_t *fn;
    js_create_function(env, "close", -1, pear_pipe_close, NULL, &fn);
    js_set_named_property(env, exports, "close", fn);
  }

  return exports;
}

PEAR_MODULE(pear_pipe, init)
