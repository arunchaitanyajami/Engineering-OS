/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: "node_modules"
    },
    includeOnly:
      "^(apps/[^/]+/(src|tests|src-tauri/src)|apps/[^/]+/(vite|playwright)\\.config\\.ts|packages/[^/]+/(src|tests))",
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
    }
  ]
};
