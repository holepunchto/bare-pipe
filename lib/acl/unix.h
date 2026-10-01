#ifndef BARE_PIPE_ACL_UNIX_H
#define BARE_PIPE_ACL_UNIX_H

#include <stdbool.h>
#include <stdint.h>
#include <uv.h>

#include "credentials.h"

// The kernel captures the peer's credentials when the socket connects, so the
// time of the connection is never needed.
static inline uint64_t
bare_pipe_acl_timestamp(void) {
  return 0;
}

static inline int
bare_pipe_acl_is_local_client(uv_pipe_t *client, bool *result) {
  *result = true;

  return 0;
}

static inline void
bare_pipe_acl_credentials_destroy(bare_pipe_acl_credentials_t *credentials) {}

#endif // BARE_PIPE_ACL_UNIX_H
