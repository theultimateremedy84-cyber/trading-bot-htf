/**
 * Schema index — single source of truth.
 *
 * Each table lives in its own file. This file re-exports everything so that
 * consumers can import from "@workspace/db" or "@workspace/db/schema" without
 * knowing the internal layout.
 *
 * DO NOT define tables inline here. Add them to their own file and re-export.
 */

export * from "./signals";
export * from "./trades";
export * from "./botSettings";
