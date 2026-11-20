import { defineRailway, github, project, service } from "railway/iac";

// Railway's configuration for this repository (Infrastructure as Code). It replaces railway.json, which
// Railway stops reading on 2026-12-01. Nothing here applies on a push: changes reach Railway only through
// `railway config plan` and `railway config apply` (see docs/deploy/railway.md).
//
// This repository manages only its own resources in the project.
export const partial = "praxis-redesign";

export default defineRailway((ctx) => {
  // The original service, kept as it is (Tarek's decision): it serves the build of 2026-10-30.
  //
  // Its stored settings run the database migration before each deploy. It has no database, so every deploy
  // since then fails at that step and the October build keeps serving. That is kept on purpose, as the
  // service's freeze. Removing preDeploy here un-freezes it: the next merge to main would then deploy the
  // current build to it. Only do that by decision (2026-11-21: keep it frozen).
  const praxisRedesign = service("praxis-redesign", {
    source: github("bobibcgroup/praxis-redesign", { branch: "main", checkSuites: false }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["**", "!docs/**", "!README.md", "!.github/**", "!e2e/**", "!video/**", "!tools/**", "!services/**"],
    },
    start: "npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    preDeploy: "npm run db:migrate",
    replicas: { "europe-west4-drams3a": 1 },
  });

  // Staging's services (gateway, ai, Postgres, Redis) are set in the dashboard and are not managed here, so
  // applying this file to staging changes nothing there.
  return project("praxis-redesign", {
    variables: { managed: false },
    resources: ctx.environment === "production" ? [praxisRedesign] : [],
  });
});
