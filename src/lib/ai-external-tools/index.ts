// Index of all external tools registered with the Monty sandbox.
// Each file in this directory corresponds to one Python-callable external function.
// Add new tools here and register their names in ai-chat-constants.ts (EXTERNAL_FUNCTIONS).

export { BAM_MODS_SIGNATURE, makeBamMods } from "./bam-mods";
export {
    CONTINUE_THINKING_SIGNATURE,
    makeContinueThinking,
} from "./continue-thinking";
export { LS_SIGNATURE, makeLs } from "./ls";
export { MINIMAP2_SIGNATURE, makeRunMinimap2 } from "./minimap2";
export { makePeek, PEEK_SIGNATURE } from "./peek";
export { makePlotHistogram, PLOT_HISTOGRAM_SIGNATURE } from "./plot-histogram";
export { makePlotSeries, PLOT_SERIES_SIGNATURE } from "./plot-series";
export { makeReadFile, READ_FILE_SIGNATURE } from "./read-file";
export { makeReadInfo, READ_INFO_SIGNATURE } from "./read-info";
export { makeSeqTable, SEQ_TABLE_SIGNATURE } from "./seq-table";
export { makeWindowReads, WINDOW_READS_SIGNATURE } from "./window-reads";
export {
    makeWriteFile,
    resetSessionWrittenFiles,
    WRITE_FILE_SIGNATURE,
} from "./write-file";
