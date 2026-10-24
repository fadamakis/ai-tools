import { Quiet } from '@ai-tools/ui';
export { Secondary, Quiet } from '@ai-tools/ui';
import React, { useRef } from 'react';
import { Button } from '@ai-tools/ui';
import { Plus, X, ArrowRight, Reload, TableCellsFilled as Table, Search, Archive, Folder, DotsHorizontal, Filter } from '@openai/apps-sdk-ui/components/Icon';
export { Button };
export { Input } from '@ai-tools/ui';
export { Textarea } from '@ai-tools/ui';
export { Menu } from '@ai-tools/ui';
export { Checkbox } from '@ai-tools/ui';
export { SegmentedControl } from '@ai-tools/ui';
export { Badge } from '@ai-tools/ui';
export { Select } from '@ai-tools/ui';
export { Tooltip } from '@ai-tools/ui';
export { TextLink } from '@ai-tools/ui';
export { Alert } from '@ai-tools/ui';
export { EmptyMessage } from '@ai-tools/ui';
export { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';

export function Icon({ name, ...props }) {
  const Component = { plus: Plus, close: X, arrow: ArrowRight, refresh: Reload, board: Table, search: Search, archive: Archive, folder: Folder, more: DotsHorizontal, filters: Filter }[name];
  return <Component width="18" height="18" aria-hidden="true" {...props}/>;
}
export function submitForm(event, callback) {
  event.preventDefault(); const form = event.currentTarget.tagName === 'FORM' ? event.currentTarget : event.currentTarget.closest('form');
  if (form?.reportValidity()) void callback();
}
export function enterSubmits(event, callback) {
  if (event.key === 'Enter' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.target.tagName === 'INPUT') submitForm(event, callback);
}
export { BoardDialog as Dialog } from '@ai-tools/ui/dialogs';
