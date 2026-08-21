# Optional rendering boundary

Rendering is intentionally outside the core reader dependency graph. A future
adapter may consume page operations to produce Canvas, SVG, or bitmap output
with a separately stated memory budget.
