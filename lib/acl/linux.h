#ifndef BARE_PIPE_ACL_LINUX_H
#define BARE_PIPE_ACL_LINUX_H

#include <errno.h>
#include <stdint.h>
#include <sys/socket.h>
#include <uv.h>

#include "credentials.h"
#include "unix.h"

static int
bare_pipe_acl_peer_credentials(uv_pipe_t *handle, uint64_t connected, bare_pipe_acl_credentials_t *result) {
  uv_os_fd_t fd;
  int err = uv_fileno((uv_handle_t *) handle, &fd);
  if (err < 0) return err;

  struct ucred cred;
  socklen_t len = sizeof(cred);

  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return uv_translate_sys_error(errno);

  // A peer in another PID namespace reports 0, and an unconnected socket -1.
  if (cred.pid > 0) result->pid = cred.pid;
  if (cred.uid != (uid_t) -1) result->uid = cred.uid;
  if (cred.gid != (gid_t) -1) result->gid = cred.gid;

  return 0;
}

#endif // BARE_PIPE_ACL_LINUX_H
