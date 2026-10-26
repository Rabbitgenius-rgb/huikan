import React, {forwardRef} from 'react';
import {motion, useIsPresent, useReducedMotion} from 'motion/react';

// Project-owned presence surfaces built directly with the MIT-licensed Motion API.
// Keeping these in one place makes exit accessibility and reduced motion consistent.
const surfaces = {
  row: {element: motion.article, axis: 'y', enter: 6, leave: -4},
  reader: {element: motion.aside, axis: 'x', enter: 12, leave: 6},
};
const Surface = forwardRef(function Surface({kind, children, ...attributes}, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const spec = surfaces[kind];
  const Element = spec.element;
  const resting = {opacity: 1, [spec.axis]: 0};
  return <Element {...attributes} ref={ref}
    data-motion={`recall-${kind}`} data-presence={present ? 'present' : 'exiting'}
    inert={present ? undefined : true} aria-hidden={present ? undefined : true}
    layout={kind === 'row' && !reduced ? 'position' : false}
    initial={reduced ? false : {opacity: 0, [spec.axis]: spec.enter}}
    animate={resting}
    exit={reduced ? resting : {opacity: 0, [spec.axis]: spec.leave}}
    transition={{duration: reduced ? 0 : 0.2, ease: 'easeOut'}}>
    {children}
  </Element>;
});
export const RecallMotionRow = forwardRef((props, ref) => <Surface {...props} ref={ref} kind="row"/>);
export const RecallMotionReader = forwardRef((props, ref) => <Surface {...props} ref={ref} kind="reader"/>);
