#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <dlfcn.h>

/**
 * Intercepteur getaddrinfo pour contourner les blocages IPv6 / DNS vers GitHub.
 * Force la résolution IPv4 directe vers les passerelles GitHub opérationnelles.
 */
int getaddrinfo(const char *node, const char *service,
                const struct addrinfo *hints,
                struct addrinfo **res) {
    static int (*real_getaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **) = NULL;
    if (!real_getaddrinfo) {
        real_getaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo");
        if (!real_getaddrinfo) {
            return EAI_SYSTEM;
        }
    }
    if (node) {
        if (strcmp(node, "api.github.com") == 0) return real_getaddrinfo("140.82.121.6", service, hints, res);
        if (strcmp(node, "github.com") == 0 || strstr(node, "github.com") != NULL) return real_getaddrinfo("140.82.121.3", service, hints, res);
    }
    return real_getaddrinfo(node, service, hints, res);
}
