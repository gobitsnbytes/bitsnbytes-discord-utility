const ANSI = {
	reset:   '\u001b[0m',
	bold:    '\u001b[1m',
	red:     '\u001b[0;31m',
	green:   '\u001b[0;32m',
	yellow:  '\u001b[0;33m',
	blue:    '\u001b[0;34m',
	magenta: '\u001b[0;35m',
	cyan:    '\u001b[0;36m',
	white:   '\u001b[0;37m',
	boldRed:    '\u001b[1;31m',
	boldGreen:  '\u001b[1;32m',
	boldYellow: '\u001b[1;33m',
	boldCyan:   '\u001b[1;36m',
};

function format(text, style) {
	return `${style}${text}${ANSI.reset}`;
}

function ansiBlock(lines) {
	return '```ansi\n' + lines.join('\n') + '\n```';
}

module.exports = {
	ANSI,
	format,
	ansiBlock,
};
