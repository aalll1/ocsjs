import { createRenderScript, $elements } from 'easy-us';
import { installPanelDragging } from './utils/panel-drag';

export const RenderScript = createRenderScript({
	name: '🖼️ 窗口设置'
});

// Keep the framework's window and position settings; replace its legacy drag handling.
RenderScript.oncomplete = function () {
	if ($elements.root) installPanelDragging($elements.root, this.methods.setPosition);
};
