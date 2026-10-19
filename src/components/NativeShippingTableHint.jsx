import React from 'react';
import {useTranslation} from 'react-i18next';
import {nativeShipping} from '../nativeShippingBridge';

export default function NativeShippingTableHint(){
 const {t}=useTranslation();
 return nativeShipping?<p className="shipping-table-hint"><span aria-hidden="true">↔</span>{t('shipping_swipe_table')}</p>:null;
}
