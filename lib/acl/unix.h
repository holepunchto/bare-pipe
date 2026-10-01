#ifndef BARE_PIPE_ACL_UNIX_H
#define BARE_PIPE_ACL_UNIX_H

#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <sys/stat.h>
#include <uv.h>

#include "credentials.h"

// The kernel captures the peer's credentials when the socket connects, so the
// time of the connection is never needed.
static inline uint64_t
bare_pipe_acl_timestamp(void) {
  return 0;
}

static inline int
bare_pipe_acl_is_owner_client(uv_pipe_t *client, uint64_t connected, bool *result) {
  *result = true;

  return 0;
}

// Changed without following a symbolic link that replaced the socket, which on
// Linux the C library does through fchmodat2() or, on kernels before 6.6,
// through /proc.
static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  if (fchmodat(AT_FDCWD, path, S_IRUSR | S_IWUSR, AT_SYMLINK_NOFOLLOW) != 0) return uv_translate_sys_error(errno);

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {}

#endif // BARE_PIPE_ACL_UNIX_H
