#ifndef BARE_PIPE_ACL_BSD_H
#define BARE_PIPE_ACL_BSD_H

#include <errno.h>
#include <stdint.h>
#include <sys/socket.h>
#include <unistd.h>
#include <uv.h>

#ifdef __APPLE__
#include <sys/un.h>
#endif

#include "credentials.h"
#include "unix.h"

static int
bare_pipe_acl_peer_credentials(uv_pipe_t *handle, uint64_t connected, bare_pipe_acl_credentials_t *result) {
  uv_os_fd_t fd;
  int err = uv_fileno((uv_handle_t *) handle, &fd);
  if (err < 0) return err;

  uid_t uid;
  gid_t gid;

  if (getpeereid(fd, &uid, &gid) != 0) return uv_translate_sys_error(errno);

  result->uid = uid;
  result->gid = gid;

#ifdef __APPLE__
  pid_t pid;
  socklen_t len = sizeof(pid);

  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &len) == 0 && pid > 0) result->pid = pid;
#endif

  return 0;
}

#endif // BARE_PIPE_ACL_BSD_H
