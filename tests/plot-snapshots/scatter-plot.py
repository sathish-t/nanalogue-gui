# Monty sandbox fixture for the plot_series scatter renderer.

points = [
    {"x": 1, "y": 0.18},
    {"x": 2, "y": 0.32},
    {"x": 3, "y": 0.27},
    {"x": 4, "y": 0.51},
    {"x": 5, "y": 0.63},
    {"x": 6, "y": 0.58},
    {"x": 7, "y": 0.79},
    {"x": 8, "y": 0.88},
]

plot_series(
    points,
    kind="scatter",
    output_path="scatter-plot.svg",
    xlabel="Genomic position (kb)",
    ylabel="Signal",
    title="Signal by genomic position - simulated data",
)
