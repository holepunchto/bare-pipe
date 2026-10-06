#ifndef BARE_PIPE_ACL_CREDENTIALS_H
#define BARE_PIPE_ACL_CREDENTIALS_H

#include <stdint.h>

typedef struct {
  int64_t pid;
  int64_t uid;
  int64_t gid;
  char *sid;
} bare_pipe_acl_credentials_t;

#endif // BARE_PIPE_ACL_CREDENTIALS_H
