import type { ChoiceQuestion } from '@ocsjs/core';

/** DOM reading is separate from the answer source and page-clicking implementation. */
export function getChoiceQuestionType(root: HTMLElement): ChoiceQuestion['type'] | undefined {
	if (root.classList.contains('single_selection')) return 'single';
	if (root.classList.contains('multiple_selection')) return 'multiple';
	if (root.classList.contains('true_or_false')) return 'judgement';
	return undefined;
}

function plainText(element: Element) {
	const copy = element.cloneNode(true) as HTMLElement;
	copy.querySelectorAll('script,style,input,.option-index,.left,[aria-hidden="true"]').forEach((node) => node.remove());
	copy.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
	copy.querySelectorAll('p,div,li').forEach((node) => node.append('\n'));
	return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

export function readChoiceQuestion(root: HTMLElement): ChoiceQuestion {
	const type = getChoiceQuestionType(root);
	if (!type) throw new Error('当前题型尚未接入文本联网答题，可在题型读取模块中扩展。');
	const description = root.querySelector('.subject-description');
	const elements = Array.from(root.querySelectorAll('ol.subject-options > li.option'));
	if (!description || elements.length < 2 || elements.length > 26)
		throw new Error('题干或选项结构不完整，本题未发送。');
	if (
		description.querySelector('img,canvas,svg') ||
		elements.some((element) => element.querySelector('img,canvas,svg'))
	) {
		throw new Error('本题包含图片或图形，当前仅支持文本题；需要单独的图片题适配。');
	}
	const question: ChoiceQuestion = {
		type,
		title: plainText(description),
		options: elements.map((element, index) => ({
			id: String.fromCharCode(65 + index),
			text: plainText(element.querySelector('.option-content') || element)
		}))
	};
	if (!question.title || question.options.some((option) => !option.text))
		throw new Error('题干或选项文本为空，本题未发送。');
	return question;
}
