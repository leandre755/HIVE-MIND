import {
  allowEditorTypeInSandbox,
  hasValidEditorCommand,
  EditorType,
  EDITOR_DISPLAY_NAMES,
} from '../contexts/UIStateContext.js';

export interface EditorDisplay {
  name: string;
  type: EditorType | 'not_set';
  disabled: boolean;
}

class EditorSettingsManager {
  private readonly availableEditors: EditorDisplay[];

  constructor() {
    const editorTypes = Object.keys(EDITOR_DISPLAY_NAMES).sort() as unknown as EditorType[];
    this.availableEditors = [
      {
        name: 'None',
        type: 'not_set',
        disabled: false,
      },
      ...editorTypes.map((type) => {
        const hasEditor = hasValidEditorCommand(type);
        const isAllowedInSandbox = allowEditorTypeInSandbox(type, '');

        let labelSuffix = !isAllowedInSandbox ? ' (Not available in sandbox)' : '';
        labelSuffix = !hasEditor ? ' (Not installed)' : labelSuffix;

        return {
          name:
            String(Reflect.get(EDITOR_DISPLAY_NAMES, type as unknown as PropertyKey) ?? type) +
            labelSuffix,
          type,
          disabled: !hasEditor || !isAllowedInSandbox,
        };
      }),
    ];
  }

  getAvailableEditorDisplays(): EditorDisplay[] {
    return this.availableEditors;
  }
}

export const editorSettingsManager = new EditorSettingsManager();
