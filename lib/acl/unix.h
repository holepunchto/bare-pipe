#ifndef BARE_PIPE_ACL_UNIX_H
#define BARE_PIPE_ACL_UNIX_H

#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <sys/stat.h>
#include <unistd.h>
#include <uv.h>

#include "credentials.h"

// Unused, as the kernel captures the credentials of the peer as it connects.
static inline uint64_t
bare_pipe_acl_timestamp(void) {
  return 0;
}

static int
bare_pipe_acl_peer_credentials(uv_pipe_t *handle, uint64_t connected, bare_pipe_acl_credentials_t *result);

// The mode alone admits users that may bypass it, such as with CAP_DAC_OVERRIDE.
static int
bare_pipe_acl_is_owner_client(uv_pipe_t *client, uint64_t connected, bool *result) {
  bare_pipe_acl_credentials_t credentials = {-1, -1, -1, NULL};

  int err = bare_pipe_acl_peer_credentials(client, connected, &credentials);
  if (err < 0) return err;

  *result = credentials.uid == geteuid() || credentials.uid == 0;

  return 0;
}

static int
bare_pipe_acl_restrict_to_owner(uv_pipe_t *handle, const char *path) {
  if (fchmodat(AT_FDCWD, path, S_IRUSR | S_IWUSR, AT_SYMLINK_NOFOLLOW) != 0) return uv_translate_sys_error(errno);

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {}

#endif // BARE_PIPE_ACL_UNIX_H
