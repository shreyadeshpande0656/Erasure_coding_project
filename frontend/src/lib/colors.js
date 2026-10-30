// One colour per source block, used in all three tabs so B1..B4 always look the same.
export const BLOCK_COLORS = ['#38bdf8', '#facc15', '#fb923c', '#f472b6', '#34d399', '#c084fc', '#f87171', '#a3e635']
export const blockColor = (i) => BLOCK_COLORS[i % BLOCK_COLORS.length]
export const label = (seq) => `P${seq + 1}`        // packet numbers are shown from 1
export const blabel = (i) => `B${i + 1}`
