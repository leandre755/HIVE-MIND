import React, { useCallback, useContext, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { ModelSlashCommandEvent, logModelSlashCommand } from '../contexts/UIStateContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { SettingScope } from '../../config/settings.js';
import { providerRouter } from '../../../providers/index.js';

interface ModelDialogProps {
  onClose: () => void;
}

export function ModelDialog({ onClose }: ModelDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const settings = useSettings();
  const [view, setView] = useState<'family' | 'model'>('family');
  const [selectedFamily, setSelectedFamily] = useState<string>('');
  const [persistMode, setPersistMode] = useState(false);

  // Determine the Preferred Model (read once when the dialog opens).
  const preferredModel = config?.getModel() || 'default';

  const families = useMemo(() => {
    return providerRouter.listFamilies();
  }, []);

  const options = useMemo(() => {
    if (view === 'family') {
      return families.map((f) => ({
        value: f.id,
        title: f.name || f.id,
        description: `${f.models.length} modèles disponibles ${f.hasApiKey ? '✅' : '❌ (Pas de clé)'}`,
        key: f.id,
      }));
    } else {
      const familyObj = families.find((f) => f.id === selectedFamily);
      const models = familyObj?.models || [];
      const list = models.map((m) => ({
        value: m,
        title: m,
        description: `Sélectionner le modèle ${m}`,
        key: m,
      }));
      list.unshift({
        value: 'back',
        title: '⬅️ Retour aux familles',
        description: "Revenir à la liste des providers d'IA",
        key: 'back',
      });
      return list;
    }
  }, [view, selectedFamily, families]);

  // Calculate the initial index based on the preferred model.
  const initialIndex = useMemo(() => {
    if (view === 'family') {
      const parsed = providerRouter.parseModelString(preferredModel);
      if (parsed) {
        const idx = options.findIndex((o) => o.value === parsed.family);
        return idx !== -1 ? idx : 0;
      }
      return 0;
    } else {
      const idx = options.findIndex((o) => o.value === preferredModel);
      return idx !== -1 ? idx : 0;
    }
  }, [preferredModel, options, view]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (view === 'model') {
          setView('family');
        } else {
          onClose();
        }
        return true;
      }
      if (key.name === 'tab') {
        setPersistMode((prev) => !prev);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  // Handle selection internally (Autonomous Dialog).
  const handleSelect = useCallback(
    (val: string) => {
      if (view === 'family') {
        setSelectedFamily(val);
        setView('model');
      } else {
        if (val === 'back') {
          setView('family');
          return;
        }

        if (config) {
          config.setModel(val, persistMode ? false : true);
          if (persistMode) {
            settings.setValue(SettingScope.User, 'defaultModel', val);
          }
          const event = new ModelSlashCommandEvent(val);
          logModelSlashCommand(config, event);
        }
        onClose();
      }
    },
    [view, config, onClose, persistMode, settings],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>
        {view === 'family'
          ? "Sélectionner un Provider d'IA"
          : `Sélectionner un Modèle (${selectedFamily})`}
      </Text>

      <Box marginTop={1}>
        <DescriptiveRadioButtonSelect
          items={options}
          onSelect={handleSelect}
          initialIndex={initialIndex}
          showNumbers={true}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color={theme.text.primary}>
            Mémoriser le modèle pour les prochaines sessions :{' '}
          </Text>
          <Text color={theme.status.success}>{persistMode ? 'true' : 'false'}</Text>
          <Text color={theme.text.secondary}> (Appuyer sur Tab pour basculer)</Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>(Echap pour revenir ou fermer)</Text>
      </Box>
    </Box>
  );
}
