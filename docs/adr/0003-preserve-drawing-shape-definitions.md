# Preserve drawing shape definitions alongside geographic geometry

Circles, rectangles, and arrows must retain their shape-specific editing behavior after consumer storage and reload. Drawings therefore provide ordinary GeoJSON geometry together with a documented shape definition that consumers preserve, accepting the additional storage contract because flattened geometry alone cannot reliably recover the original shape and its editing parameters. Imported geometry without a shape definition remains an ordinary line or polygon; Ridgeline does not guess the original shape.
