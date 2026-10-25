import { corporateSnapshot } from "./corporate-model-policy.ts";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const THINKING_LEVEL_SUFFIXES = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Model scoping shared by the UI selector and AgentSession startup.
 *
 * The `enabledModels` setting uses the same syntax as pi's `--models` flag:
 * globs matched with minimatch against `provider/modelId` or a bare `modelId`,
 * fuzzy matching for non-glob patterns, plus an optional `:thinkingLevel` suffix
 * (`anthropic/*:high`). Exact string comparison silently drops every model
 * behind a pattern like `my-gateway/*` (#307), so delegate to pi's own resolver
 * instead of reimplementing the matching rules here.
 */

export interface ModelScopeResult {
  /** Models the UI should offer, in resolver order (all available when unscoped). */
  visible: readonly Model<Api>[];
  /** SDK-native scope retained for AgentSession model cycling and extensions. */
  scopedModels: readonly ScopedModel[];
  /** `provider/modelId` → thinking level pinned with a `:level` pattern suffix. */
  thinkingLevelPins: Record<string, string>;
  /** Resolver diagnostics, e.g. a pattern that matched no model. */
  warnings: string[];
}

export interface InitialModelScopeOptions {
  requestedModel?: { provider: string; modelId: string };
  defaultModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface InitialModelScopeResult {
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  scopedModels: ScopedModel[];
}

function matchesModel(
  model: { provider: string; id: string },
  ref: { provider: string; modelId: string },
): boolean {
  return model.provider === ref.provider && model.id === ref.modelId;
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

function isSuppressibleUnmatchedGlob(pattern: string): boolean {
  if (!hasGlob(pattern)) return false;
  const colonIndex = pattern.lastIndexOf(":");
  return colonIndex < 0
    || THINKING_LEVEL_SUFFIXES.has(pattern.slice(colonIndex + 1) as ThinkingLevel);
}

function exactReferenceMatches(pattern: string, models: readonly Model<Api>[]): Model<Api>[] {
  const normalized = pattern.toLowerCase();
  const canonical = models.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalized,
  );
  if (canonical.length > 0) return canonical;
  return models.filter((model) => model.id.toLowerCase() === normalized);
}

function assertNoAmbiguousExactPatterns(
  patterns: readonly string[],
  models: readonly Model<Api>[],
): void {
  for (const pattern of patterns) {
    if (hasGlob(pattern)) continue;

    let matches = exactReferenceMatches(pattern, models);
    if (matches.length === 0) {
      const colonIndex = pattern.lastIndexOf(":");
      const suffix = colonIndex >= 0 ? pattern.slice(colonIndex + 1) : "";
      if (THINKING_LEVEL_SUFFIXES.has(suffix as ThinkingLevel)) {
        matches = exactReferenceMatches(pattern.slice(0, colonIndex), models);
      }
    }

    if (matches.length > 1) {
      const references = matches
        .map((model) => `${model.provider}/${model.id}`)
        .sort()
        .join(", ");
      throw new Error(
        `Ambiguous enabledModels entry "${pattern}" matches multiple models: ${references}. Use provider/modelId.`,
      );
    }
  }
}

/**
 * Resolve the visible model list for `patterns`.
 *
 * Falls back to every available model when no patterns are configured or when
 * the patterns resolve to nothing, so a stale or typo'd setting can never leave
 * the UI without any selectable model.
 */
export async function resolveVisibleModels(
  modelRuntime: ModelRuntime,
  patterns: string[] | undefined,
): Promise<ModelScopeResult> {
  const cleaned = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  const available = await modelRuntime.getAvailable();
  const finish = (scope: ModelScopeResult): ModelScopeResult => {
    const reference = corporateSnapshot()?.defaultModel;
    if (!reference || scope.visible.some((model) => matchesModel(model, reference))) return scope;
    const model = available.find((candidate) => matchesModel(candidate, reference));
    if (!model) throw new Error("Модель компании по умолчанию недоступна");
    return { ...scope, visible: [model, ...scope.visible], scopedModels: scope.scopedModels.length ? [{ model }, ...scope.scopedModels] : [] };
  };
  if (cleaned.length === 0) {
    return finish({
      visible: available,
      scopedModels: [],
      thinkingLevelPins: {},
      warnings: [],
    });
  }
  assertNoAmbiguousExactPatterns(cleaned, available);
  const snapshotRuntime = {
    getAvailable: async () => available,
  } as ModelRuntime;
  const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleaned, snapshotRuntime);
  // In corporate mode the personal `enabledModels` list is leftover state: it
  // can still name a model that only ever existed under a personal key (for
  // example "minimax/MiniMax-M3" from before the company gateway existed).
  // Such a pattern matches nothing in the corporate catalogue and would show
  // a permanent "no models match" warning in the employee chat, so ignore it
  // instead of nagging about the company's own configuration.
  const corporate = corporateSnapshot();
  // A leftover valid glob after a model was removed is not a chat-level problem
  // when other enabledModels entries still matched. Keep exact and malformed
  // pattern warnings, and keep all no-match warnings for a total miss, where
  // the UI falls back to every available model and the user needs to know the
  // scope did not apply.
  const warnings = diagnostics
    .filter((diagnostic) => {
      if (diagnostic.code === "no-match" && corporate) return false;
      return (
        diagnostic.code !== "no-match"
        || scopedModels.length === 0
        || !isSuppressibleUnmatchedGlob(diagnostic.pattern)
      );
    })
    .map((diagnostic) => diagnostic.message);
  if (scopedModels.length === 0) {
    return finish({
      visible: available,
      scopedModels: [],
      thinkingLevelPins: {},
      warnings,
    });
  }

  // `anthropic/*:high` pins a thinking level on every model the glob matched.
  // pi applies the pin of the model a new session starts with; report them all
  // so the client can look up whichever model it pre-selects.
  const thinkingLevelPins: Record<string, string> = {};
  for (const scoped of scopedModels) {
    if (scoped.thinkingLevel) {
      thinkingLevelPins[`${scoped.model.provider}/${scoped.model.id}`] = scoped.thinkingLevel;
    }
  }
  return finish({
    visible: scopedModels.map((scoped) => scoped.model),
    scopedModels,
    thinkingLevelPins,
    warnings,
  });
}

/**
 * The model selector's order, as in pi's `/model` (the TUI's
 * ModelSelectorComponent): a scope keeps its `enabledModels` order; the full
 * list is sorted by provider id only, so each provider keeps its registry
 * order, which for a models.json provider is the file's order (#783). The TUI
 * also lifts the current and default models to the top; the web selector marks
 * them in place instead.
 */
export function orderSelectorModels(scope: ModelScopeResult): Model<Api>[] {
  if (scope.scopedModels.length > 0) return [...scope.visible];
  // Array.prototype.sort is stable: models of one provider keep their order.
  return [...scope.visible].sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Select the model and thinking level used to create a new AgentSession.
 *
 * This mirrors pi's startup rule: prefer an explicit selection, otherwise use
 * the saved default when it is in scope, then the first resolver-ordered model.
 * A scoped-model thinking pin is applied unless the caller supplied an explicit
 * thinking level.
 */
export function selectInitialModelScope(
  scope: ModelScopeResult,
  options: InitialModelScopeOptions = {},
): InitialModelScopeResult {
  const requestedRef = options.requestedModel;
  const defaultRef = corporateSnapshot()?.defaultModel ?? options.defaultModel;
  const requested = requestedRef
    ? scope.visible.find((model) => matchesModel(model, requestedRef))
    : undefined;
  if (requestedRef && !requested) {
    throw new Error(
      `Model is not available in the enabled scope: ${requestedRef.provider}/${requestedRef.modelId}`,
    );
  }

  const requestedScoped = requested
    ? scope.scopedModels.find((scoped) => scoped.model === requested
      || matchesModel(scoped.model, { provider: requested.provider, modelId: requested.id }))
    : undefined;
  const defaultScoped = !requested && defaultRef
    ? scope.scopedModels.find((scoped) => matchesModel(scoped.model, defaultRef))
    : undefined;
  const fallbackScoped = !requested ? (defaultScoped ?? scope.scopedModels[0]) : undefined;
  const defaultVisible = !requested && !fallbackScoped && defaultRef
    ? scope.visible.find((model) => matchesModel(model, defaultRef))
    : undefined;
  const selectedModel = requested ?? fallbackScoped?.model ?? defaultVisible;
  const scopedSelection = requestedScoped ?? fallbackScoped;
  const thinkingLevel = options.thinkingLevel ?? scopedSelection?.thinkingLevel;

  return {
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    scopedModels: [...scope.scopedModels],
  };
}
