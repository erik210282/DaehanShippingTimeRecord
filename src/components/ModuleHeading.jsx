import {uiTitle} from './actionTheme.mjs';
import React from 'react';
export default function ModuleHeading({title}) {return <h1 className="module-title">{uiTitle(title)}</h1>;}
