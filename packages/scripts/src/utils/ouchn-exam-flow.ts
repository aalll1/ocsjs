export type ExamStatus = 'answering' | 'awaiting-result' | 'retry' | 'complete' | 'skip' | 'stopped';
export interface ExamSession {
	id: string;
	failures: number;
	seen: string[];
	status: ExamStatus;
	updated: number;
	pendingNotice?: string;
	feedback?: { title: string; selected: string[]; correct: boolean }[];
}

/** One result page is counted once, even after refresh or duplicate observers. */
export function recordExamResult(
	session: Pick<ExamSession, 'failures' | 'seen' | 'status'>,
	submission: string,
	score: number | null,
	maximum: number
) {
	if (
		session.seen.includes(submission) ||
		typeof score !== 'number' ||
		!Number.isFinite(score) ||
		score < 0 ||
		!Number.isFinite(maximum) ||
		maximum <= 0 ||
		score > maximum
	)
		return null;
	session.seen.push(submission);
	if (Math.abs(score - maximum) < 0.00001) {
		session.failures = 0;
		session.status = 'complete';
		return { notice: 'complete' as const };
	}
	session.failures++;
	session.status = session.failures >= 3 ? 'skip' : 'retry';
	return {
		notice: session.failures >= 3 ? ('skip' as const) : session.failures === 1 ? ('retry' as const) : undefined
	};
}

export function readExamScore(doc: Document) {
	const result = doc.querySelector('.exam-paper.exam-result');
	if (!result) return null;
	const scoreText = doc.querySelector('[ng-bind="submissionData.score"]')?.textContent?.trim();
	if (!scoreText || !/^\d+(\.\d+)?$/.test(scoreText)) return null;
	const subjects = Array.from(result.querySelectorAll('li.subject:not(.text)'));
	if (!subjects.length) return null;
	const points = subjects.map((e) => e.querySelector('[ng-bind="subject.getPoint()"]')?.textContent?.trim());
	if (points.some((p) => !p || !/^\d+(\.\d+)?$/.test(p))) return null;
	return { score: Number(scoreText), maximum: points.reduce((sum, p) => sum + Number(p), 0) };
}

/** Submission is allowed only when every real question has a successful resolver result. */
export function canSubmitExam(doc: Document, results: { result?: { finish?: boolean }; error?: unknown }[]) {
	const subjects = Array.from(doc.querySelectorAll('.subjects-jit-display > li.subject:not(.text)'));
	return (
		subjects.length > 0 &&
		subjects.length === results.length &&
		results.every((r) => !r.error && r.result?.finish) &&
		subjects.every((root) => {
			if (!root.matches('.single_selection, .multiple_selection, .true_or_false')) return false;
			const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'));
			return inputs.length >= 2 && inputs.some((i) => i.checked) && inputs.every((i) => !i.disabled);
		})
	);
}
