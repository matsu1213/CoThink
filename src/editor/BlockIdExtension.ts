import { Extension } from '@tiptap/core';
export const BlockIdExtension=Extension.create({name:'blockId',addGlobalAttributes(){return[{types:['paragraph','heading','blockquote','codeBlock','listItem'],attributes:{blockId:{default:null,parseHTML:e=>e.getAttribute('data-block-id'),renderHTML:a=>a.blockId?{'data-block-id':a.blockId}:{}}}}]}});
