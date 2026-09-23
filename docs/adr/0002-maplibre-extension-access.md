# Allow explicit MapLibre access for advanced integrations

Ridgeline provides common feature styling and interaction operations while allowing consumers to access its underlying MapLibre map. This keeps the initial API small without preventing advanced renderer capabilities, at the cost of tying those extensions to MapLibre and requiring an ownership contract for direct modifications. A universal rendering-engine abstraction is deferred.
