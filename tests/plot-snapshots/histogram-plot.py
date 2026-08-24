# Monty sandbox fixture for the plot_histogram renderer.

bins = [
    {"bin_start": 0, "bin_end": 1000, "count": 3},
    {"bin_start": 1000, "bin_end": 2000, "count": 9},
    {"bin_start": 2000, "bin_end": 3000, "count": 17},
    {"bin_start": 3000, "bin_end": 4000, "count": 24},
    {"bin_start": 4000, "bin_end": 5000, "count": 19},
    {"bin_start": 5000, "bin_end": 6000, "count": 11},
    {"bin_start": 6000, "bin_end": 7000, "count": 5},
]

plot_histogram(
    bins,
    output_path="histogram-plot.svg",
    xlabel="Read length (bp)",
    ylabel="Read count",
    title="Read length distribution - simulated data",
)
