/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: "node_modules"
    },
    includeOnly:
      "^(apps/[^/]+/(src|tests|src-tauri/src)|apps/[^/]+/(vite|playwright)\\.config\\.ts|packages/[^/]+/(src|tests)|plugins/[^/]+/(src|tests)|agents/[^/]+/(src|tests)|workflows/[^/]+/(src|tests))",
    exclude: {
      path: "(^|/)(dist|target|coverage|test-results|playwright-report)/"
    }
  },
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: "shared-is-foundational",
      severity: "error",
      from: {
        path: "^packages/shared"
      },
      to: {
        path: "^packages/(?!shared)"
      }
    },
    {
      name: "contracts-only-depends-on-shared",
      severity: "error",
      from: {
        path: "^packages/contracts"
      },
      to: {
        path: "^packages/(?!shared|contracts)"
      }
    },
    {
      name: "source-control-domain-only-depends-on-shared",
      severity: "error",
      from: {
        path: "^packages/source-control-domain"
      },
      to: {
        path: "^packages/(?!shared|source-control-domain)"
      }
    },
    {
      name: "core-does-not-import-ui",
      severity: "error",
      from: {
        path: "^packages/core"
      },
      to: {
        path: "^packages/ui"
      }
    },
    {
      name: "apps-do-not-import-database-or-security-directly",
      severity: "error",
      from: {
        path: "^apps"
      },
      to: {
        path: "^packages/(database|security)"
      }
    },
    {
      name: "no-app-dependencies-from-packages",
      severity: "error",
      from: {
        path: "^packages"
      },
      to: {
        path: "^apps"
      }
    },
    {
      name: "plugins-do-not-import-apps",
      severity: "error",
      from: {
        path: "^plugins/"
      },
      to: {
        path: "^apps"
      }
    },
    {
      name: "plugins-only-depend-on-sdk-and-contracts",
      severity: "error",
      from: {
        path: "^plugins/"
      },
      to: {
        path: "^packages/(?!contracts|plugin-sdk|source-control-domain)"
      }
    },
    {
      name: "agents-do-not-import-apps-or-plugins",
      severity: "error",
      from: {
        path: "^agents/"
      },
      to: {
        path: "^(apps|plugins)/"
      }
    }
  ]
};
