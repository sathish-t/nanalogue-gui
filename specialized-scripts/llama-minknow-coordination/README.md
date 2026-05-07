# Coordination between llama.cpp and MinKNOW

If you are doing oxford nanopore sequencing and have a computer with a GPU,
and you want to serve a local LLM on this computer when not actively sequencing,
the script in this folder may be of some help to you.
Point your coding agent like GPT or Claude at this file, and they
may be able to help you with setting this up on your own infrastructure.
You've to set up a cron job that runs this script every minute or at 
some suitable frequency. The script monitors if MinKNOW reports active
sequencing. If not, it loads up an LLM after a cooldown period.
You should have already downloaded the LLM files and have llama.cpp
installed and python and suitable dependencies installed to run this script.
