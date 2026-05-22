// 单独生成 userscript 的脚本
const path = require('path');
const fs = require('fs');

const distDir = path.resolve(__dirname, '../dist');
const rootDir = path.resolve(__dirname, '..');

// 加载 OCS 模块
require('browser-env')();
globalThis.unsafeWindow = {};
globalThis.GM_info = { script: { version: 'dev' } };

const ocs = require(path.join(distDir, 'index.js'));
const { version } = require(path.join(rootDir, 'package.json'));

// 收集匹配域名
const matchMetadata = Array.from(
	new Set(
		ocs.definedProjects()
			.map((p) => (p.domains || []).map((d) => '*://*.' + d + '/*'))
			.flat()
	)
);

// 收集项目名称
const projectNames = ocs.definedProjects()
	.filter(p => p.name !== '通用' && p.name !== '后台调试')
	.map((s) => '【' + s.name + '】')
	.join(' ');

function buildMeta(metadata) {
	const lines = [];
	lines.push('// ==UserScript==');
	for (const [key, value] of Object.entries(metadata)) {
		if (Array.isArray(value)) {
			for (const v of value) {
				lines.push('// @' + key.padEnd(20, ' ') + '\t\t\t\t' + v);
			}
		} else {
			lines.push('// @' + key.padEnd(20, ' ') + '\t\t\t\t' + value);
		}
	}
	lines.push('// ==/UserScript==');
	return lines.join('\n');
}

const metadata = {
	name: 'OCS 网课助手',
	version: version,
	description: [
		'OCS(online-course-script) 网课助手，官网 https://docs.ocsjs.com ，专注于帮助大学生从网课中释放出来',
		'让自己的时间把握在自己的手中，拥有人性化的操作页面，流畅的步骤提示，支持 ',
		projectNames,
		'等网课的学习，作业。具体的功能请查看脚本悬浮窗中的教程页面。'
	].join(' '),
	author: 'enncy',
	license: 'MIT',
	namespace: 'https://enncy.cn',
	homepage: 'https://docs.ocsjs.com',
	source: 'https://github.com/ocsjs/ocsjs',
	icon: 'https://cdn.ocsjs.com/logo.png',
	connect: ['enncy.cn', 'icodef.com', 'ocsjs.com', 'zaizhexue.top', 'localhost', '127.0.0.1'],
	match: matchMetadata,
	grant: [
		'GM_info',
		'GM_getTab',
		'GM_saveTab',
		'GM_setValue',
		'GM_getValue',
		'unsafeWindow',
		'GM_listValues',
		'GM_deleteValue',
		'GM_notification',
		'GM_xmlhttpRequest',
		'GM_getResourceText',
		'GM_addValueChangeListener',
		'GM_removeValueChangeListener'
	],
	'run-at': 'document-start',
};

// 构建正式版
const bundleJS = fs.readFileSync(path.join(distDir, 'index.js'), 'utf-8');
const cssContent = fs.readFileSync(path.join(rootDir, 'packages/scripts/assets/css/style.css'), 'utf-8');
const entryJS = fs.readFileSync(path.join(rootDir, 'packages/scripts/entry.js'), 'utf-8');

const fullScript = [
	buildMeta(metadata),
	'const STYLE = `' + cssContent + '`;',
	bundleJS,
	entryJS,
].join('\n\n');

const outPath = path.join(distDir, 'ocs.user.js');
fs.writeFileSync(outPath, fullScript, 'utf-8');
console.log('Generated:', outPath, '(' + (fullScript.length / 1024).toFixed(0) + ' KB)');

// 构建调试版
const devMeta = { ...metadata, name: metadata.name + '(dev)' };
const devEntryJS = fs.readFileSync(path.join(rootDir, 'packages/scripts/entry.dev.js'), 'utf-8');

const devScript = [
	buildMeta(devMeta),
	'const STYLE = `' + cssContent + '`;',
	devEntryJS,
].join('\n\n');

const devOutPath = path.join(distDir, 'ocs.dev.user.js');
fs.writeFileSync(devOutPath, devScript, 'utf-8');
console.log('Generated:', devOutPath, '(' + (devScript.length / 1024).toFixed(0) + ' KB)');
