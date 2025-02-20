import { upwardRoots } from './upwardRoots.js';
export function* querySelectorUpward(el, selector) {
    if (!selector)
        return;
    for (const root of upwardRoots(el)) {
        const els = root.querySelectorAll(selector);
        for (let i = 0, l = els.length; i < l; i += 1)
            yield els[i];
    }
}
//# sourceMappingURL=querySelectorUpward.js.map