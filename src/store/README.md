# Sparse byte store

This module owns fixed-size source chunks, in-flight range coalescing, LRU
eviction, cache accounting, and read telemetry. Its public budget is expressed
in resident bytes and remains independent of source size.
