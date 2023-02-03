#include <js.h>
#include <pear.h>
#include <uv.h>

typedef struct {
  uv_tty_t handle;
  uv_write_t req;
  js_ref_t *ref;
} stdio_t;

static void
on_stdio_write (uv_write_t *req, int status) {
  printf("done!\n");
}

static js_value_t *
stdio_init (js_env_t *env, js_callback_info_t *info) {
  js_value_t *argv[2];
  size_t argc = 2;

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uv_file file;
  uv_tty_t *handle;

  js_get_value_uint32(env, argv[0], (uint32_t *) &file);
  js_get_typedarray_info(env, argv[1], NULL, (void **) &handle, NULL, NULL, NULL);

  uv_loop_t *loop;

  js_get_env_loop(env, &loop);

  int err = uv_tty_init(loop, handle, file, 0);
  if (err < 0) {
    js_throw_error(env, uv_err_name(err), uv_strerror(err));
    return NULL;
  }

  return NULL;
}

static js_value_t *
stdio_write (js_env_t *env, js_callback_info_t *info) {
  js_value_t *argv[3];
  size_t argc = 3;

  js_get_callback_info(env, info, &argc, argv, NULL, NULL);

  uv_tty_t *handle;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &handle, NULL, NULL, NULL);

  char *data;
  size_t data_len;
  js_get_typedarray_info(env, argv[0], NULL, (void **) &handle, &data_len, NULL, NULL);

  uv_buf_t buf = {
    .base = data,
    .len = data_len,
  };

  uv_write(req, handle, &buf, 1, on_stdio_write);

  return NULL;
}

static js_value_t *
stdio_exports (js_env_t *env, js_value_t *exports) {
  {
    js_value_t *val;
    js_create_uint32(env, sizeof(stdio_t), &val);
    js_set_named_property(env, exports, "sizeof_stdio_t", val);
  }

  {
    js_value_t *val;
    js_create_function(env, "stdio_init", -1, stdio_init, NULL, &val);
    js_set_named_property(env, exports, "stdio_init", val);
  }

  {
    js_value_t *val;
    js_create_function(env, "stdio_write", -1, stdio_write, NULL, &val);
    js_set_named_property(env, exports, "stdio_write", val);
  }

  return exports;
}

PEAR_MODULE(stdio_exports)
