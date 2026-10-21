// libEGL.so.1 shim for running Chromium on westonpack's crusty EGL layer.
//
// Forwards every EGL call to the real library (NW_REAL_EGL, an absolute path) and removes
// extensions listed in NW_EGL_HIDE (default: EGL_KHR_surfaceless_context, which crusty
// advertises but cannot back with a real current context; Chromium crashes probing it).
//
// aarch64 only: EGL functions take integer/pointer arguments (at most 8, all in registers)
// and return in x0, so one generic 8-argument forwarder is ABI-safe for every entry point.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uintptr_t A;
typedef A (*fwd_fn)(A, A, A, A, A, A, A, A);

static void *real;

static void *resolve(const char *name) {
    if (!real) {
        const char *path = getenv("NW_REAL_EGL");
        real = dlopen(path ? path : "/usr/lib/libEGL.so.1", RTLD_NOW | RTLD_GLOBAL);
        if (!real) fprintf(stderr, "[eglshim] cannot open %s: %s\n", path, dlerror());
    }
    return real ? dlsym(real, name) : NULL;
}

// NW_EGL_TRACE=1 logs every call with its first arguments, result and eglGetError().
static int tracing = -1;
static int trace_on(void) {
    if (tracing < 0) tracing = getenv("NW_EGL_TRACE") != NULL;
    return tracing;
}

#define FORWARD(name)                                                          \
    A name(A a, A b, A c, A d, A e, A f, A g, A h) {                           \
        static fwd_fn fn;                                                      \
        if (!fn) fn = (fwd_fn)resolve(#name);                                  \
        A r = fn ? fn(a, b, c, d, e, f, g, h) : 0;                             \
        if (trace_on() && strcmp(#name, "eglGetError")) {                      \
            static fwd_fn err;                                                 \
            if (!err) err = (fwd_fn)resolve("eglGetError");                    \
            fprintf(stderr, "[egltrace] %s(%lx, %lx, %lx, %lx) = %lx err=%lx%s\n", #name, \
                    (unsigned long)a, (unsigned long)b, (unsigned long)c, (unsigned long)d, \
                    (unsigned long)r, err ? (unsigned long)err(0,0,0,0,0,0,0,0) : 0UL, fn ? "" : " MISSING"); \
        }                                                                      \
        return r;                                                              \
    }

FORWARD(eglChooseConfig) FORWARD(eglCopyBuffers) FORWARD(eglCreateContext)
FORWARD(eglCreatePbufferSurface) FORWARD(eglCreatePixmapSurface) FORWARD(eglCreateWindowSurface)
FORWARD(eglDestroyContext) FORWARD(eglDestroySurface) FORWARD(eglGetConfigAttrib)
FORWARD(eglGetConfigs) FORWARD(eglGetCurrentDisplay) FORWARD(eglGetCurrentSurface)
FORWARD(eglGetDisplay) FORWARD(eglGetError) FORWARD(eglInitialize) FORWARD(eglMakeCurrent)
FORWARD(eglQueryContext) FORWARD(eglQuerySurface) FORWARD(eglSwapBuffers) FORWARD(eglTerminate)
FORWARD(eglWaitGL) FORWARD(eglWaitNative) FORWARD(eglBindTexImage) FORWARD(eglReleaseTexImage)
FORWARD(eglSurfaceAttrib) FORWARD(eglSwapInterval) FORWARD(eglBindAPI) FORWARD(eglQueryAPI)
FORWARD(eglCreatePbufferFromClientBuffer) FORWARD(eglReleaseThread) FORWARD(eglWaitClient)
FORWARD(eglGetCurrentContext) FORWARD(eglCreateSync) FORWARD(eglDestroySync)
FORWARD(eglClientWaitSync) FORWARD(eglGetSyncAttrib) FORWARD(eglCreateImage) FORWARD(eglDestroyImage)
FORWARD(eglGetPlatformDisplay) FORWARD(eglCreatePlatformWindowSurface)
FORWARD(eglCreatePlatformPixmapSurface) FORWARD(eglWaitSync)

#define EGL_EXTENSIONS 0x3055

static char *filtered[2];  // [0] client (no display), [1] display extensions

const char *eglQueryString(void *dpy, int name) {
    static const char *(*fn)(void *, int);
    if (!fn) fn = (const char *(*)(void *, int))resolve("eglQueryString");
    const char *s = fn ? fn(dpy, name) : NULL;
    if (!s || name != EGL_EXTENSIONS) return s;

    const char *hide = getenv("NW_EGL_HIDE");
    if (!hide) hide = "EGL_KHR_surfaceless_context";
    char **slot = &filtered[dpy != NULL];
    free(*slot);
    *slot = malloc(strlen(s) + 2);
    (*slot)[0] = 0;
    char *copy = strdup(s);
    for (char *tok = strtok(copy, " "); tok; tok = strtok(NULL, " ")) {
        char needle[256];
        snprintf(needle, sizeof needle, " %s ", tok);
        char padded[1024];
        snprintf(padded, sizeof padded, " %s ", hide);
        if (strstr(padded, needle)) { fprintf(stderr, "[eglshim] hiding %s\n", tok); continue; }
        if ((*slot)[0]) strcat(*slot, " ");
        strcat(*slot, tok);
    }
    free(copy);
    return *slot;
}

void *eglGetProcAddress(const char *name) {
    if (!strcmp(name, "eglQueryString")) return (void *)eglQueryString;
    static void *(*fn)(const char *);
    if (!fn) fn = (void *(*)(const char *))resolve("eglGetProcAddress");
    return fn ? fn(name) : NULL;
}
