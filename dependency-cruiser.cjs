/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: "node_modules"
    },
    includeOnly: "^apps|^packages"
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
