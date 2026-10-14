# Code conventions

These are Ridgeline's implementation and review standards. Apply them to the work being changed; keep unrelated cleanup out of the patch. Compiler and build settings remain authoritative in their configuration files.

## Applicable topic standards

Read the common standards below and every topic whose behavior the change affects. Select by behavior, including relevant callers and owners outside the diff. These linked files are authoritative standards; the [retrospective](.scratch/pr-review-retrospective/README.md) records their supporting evidence.

| When the change affects | Read |
| --- | --- |
| Resource ownership, callbacks, asynchronous work, deduplication, errors, recovery, or shared caches, including development tooling | [Lifecycle](docs/conventions/lifecycle.md) |
| Render publication, picking, terrain sampling, coordinate conversion, or geographic storage | [Rendering](docs/conventions/rendering.md) |
| Pointer or keyboard input, gestures, focus, hover, or interaction ownership | [Interactions](docs/conventions/interactions.md) |
| Observable behavior, parsers, tests, report consumers, or verification tooling | [Testing](docs/conventions/testing.md) |
| Entity preparation, publication, callbacks, recovery, or disposal | [Entity review](docs/agents/entity-review.md) |

## Keep the final code lean

Review every addition critically before finishing. Remove code left over from experiments, debugging, and temporary test setup. Delete duplicate paths and speculative abstractions; keep production code and tests only when they support a real behavior, constraint, or failure mode. Work that helped during development does not need to remain in the product.

## Core qualities and priorities

- **Easy to use.** Make common mapping tasks straightforward through a clear public API, useful defaults, and practical examples. Keep integration and ongoing maintenance simple for consumers.
- **Feature-rich within a clear scope.** Provide complete, reusable mapping capabilities. Keep surrounding application workflows with consumers, as defined in [ADR-0001](docs/adr/0001-consumer-owned-workflows.md).
- **Dynamic.** Support changing geographic data, live updates, and interactive exploration without requiring consumers to rebuild the viewport or lose interaction state unnecessarily.
- **Customizable.** Let consumers adapt appearance and behavior through supported APIs. Common customization should not require a fork or knowledge of rendering internals.
- **High quality.** Treat correctness, reliable lifecycle behavior, accessible interactions, visual polish, and clear documentation as part of a finished capability.
- **Responsive and performant.** Keep interactions responsive as data and views change. Evaluate rendering cost, update latency, memory use, and idle work against representative consumer workloads.

Prioritize these qualities over being lightweight for its own sake. Bundle size, dependencies, and implementation complexity still have costs, but judge those costs against the capabilities and consumer experience they enable. When qualities compete, make the tradeoff explicit and use concrete consumer needs and measurements to guide the decision.

## Module and package boundaries

- Prefer deep modules that hide complex behavior behind a small interface. Test each module's behavior through that interface.
- Keep the map library framework-neutral. Playground scenarios, sample data, and application workflows belong to consumers. Evaluate library additions against [ADR-0001](docs/adr/0001-consumer-owned-workflows.md).
- Keep public exports deliberate in `src/index.ts`. Expose a small interface that hides rendering and lifecycle machinery; exporting an internal helper solely to reach it from a test expands the wrong boundary.
- Keep the playground on the public library API. The separate control lab owns its framework dependencies and experiments.
- Use the explicit MapLibre integration allowed by [ADR-0002](docs/adr/0002-maplibre-extension-access.md). Add abstractions for concrete needs rather than hypothetical renderer replacement.

## TypeScript and data boundaries

- Preserve consumer property types through generic feature, event, and callback APIs. Infer local types and derive related types instead of maintaining parallel declarations.
- Use discriminated unions for distinct states and variants. Validate unknown external values before narrowing them; avoid `any`, unchecked assertions, and helpers whose only behavior is a cast.
- Follow the surrounding file's formatting. Keep formatting-only changes separate from behavioral work.
- Validate and snapshot consumer data at the owning boundary before mutating accepted state. Public reads must preserve the documented snapshot semantics rather than expose mutable internals.
- Use [GLOSSARY.md](GLOSSARY.md) terminology. Make coordinate order, units, altitude references, and missing-data behavior explicit at geographic boundaries. Unknown elevation must remain distinct from zero elevation.
- Preserve drawing shape metadata through storage and reload as required by [ADR-0003](docs/adr/0003-preserve-drawing-shape-definitions.md).

## Documentation

Document public behavior and integration examples in [README.md](README.md). Keep domain vocabulary in [GLOSSARY.md](GLOSSARY.md), decision rationale in [docs/adr/](docs/adr/), and feature requirements in their specs. Link to the authoritative document instead of copying its contract here.

Use comments for intent, ownership, and non-obvious constraints. Update them when behavior changes.
