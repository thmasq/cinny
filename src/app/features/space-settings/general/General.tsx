import React from 'react';
import { Box, Icon, IconButton, Icons, Scroll, Text, Button } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoom } from '../../../hooks/useRoom';
import {
  RoomProfile,
  RoomJoinRules,
  RoomLocalAddresses,
  RoomPublishedAddresses,
  RoomPublish,
  RoomUpgrade,
} from '../../common-settings/general';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';

import { useSeparatorsStore } from '../../../state/separators';
import { useFilePicker } from '../../../hooks/useFilePicker';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SequenceCardStyle } from '../styles.css';

type GeneralProps = {
  requestClose: () => void;
};

export function General({ requestClose }: GeneralProps) {
  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  const {
    spaceSeparators,
    createSeparator,
    assignChannelToSeparator,
    getSpaceSeparators,
  } = useSeparatorsStore();

  const handleExport = () => {
    const spaceId = room.roomId;
    const separatorsData = spaceSeparators[spaceId];
    
    if (!separatorsData) return;

    const exportData = {
      version: 1,
      spaceId: room.roomId,
      timestamp: Date.now(),
      ...separatorsData,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinny-separators-${room.name?.replace(/\s+/g, '-').toLowerCase() || 'space'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickFile = useFilePicker((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        importSeparators(data);
      } catch (err) {
        console.error('Failed to import separators', err);
      }
    };
    reader.readAsText(file);
  });

  const importSeparators = (data: any) => {
    const spaceId = room.roomId;
    if (!data.separators || !Array.isArray(data.separators)) return;

    const currentSeparators = getSpaceSeparators(spaceId);
    
    const idMap = new Map<string, string>();

    const localBase = currentSeparators.find(s => s.isBase);
    const importedBase = data.separators.find((s: any) => s.isBase);
    if (localBase && importedBase) {
      idMap.set(importedBase.id, localBase.id);
    }

    data.separators.forEach((importedSep: any) => {
      if (importedSep.isBase) return;

      const existing = currentSeparators.find(
        s => s.name.toLowerCase() === importedSep.name.toLowerCase()
      );

      if (existing) {
        idMap.set(importedSep.id, existing.id);
      } else {
        try {
          const newId = createSeparator(spaceId, importedSep.name);
          idMap.set(importedSep.id, newId);
        } catch (e) {
          console.warn(`Skipping separator "${importedSep.name}":`, e);
        }
      }
    });

    if (data.channelAssignments) {
      Object.entries(data.channelAssignments).forEach(([channelId, oldSepId]) => {
        const newSepId = idMap.get(oldSepId as string);
        if (newSepId) {
          assignChannelToSeparator(spaceId, channelId, newSepId);
        }
      });
    }
  };

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              General
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <RoomProfile permissions={permissions} />
              
              {/* NEW SECTION: Separator Configuration */}
              <Box direction="Column" gap="100">
                <Text size="L400">Separator Configuration</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Export Layout"
                    description="Save a backup of your current category setup to a file."
                    after={
                      <Button
                        onClick={handleExport}
                        size="300"
                        variant="Secondary"
                        fill="Soft"
                        outlined
                        radii="300"
                      >
                        <Text size="B300">Export</Text>
                      </Button>
                    }
                  />
                  <SettingTile
                    title="Import Layout"
                    description="Restore categories and channel assignments from a backup file."
                    after={
                      <Button
                        onClick={() => pickFile('application/json')}
                        size="300"
                        variant="Secondary"
                        fill="Soft"
                        outlined
                        radii="300"
                      >
                        <Text size="B300">Import</Text>
                      </Button>
                    }
                  />
                </SequenceCard>
              </Box>

              <Box direction="Column" gap="100">
                <Text size="L400">Options</Text>
                <RoomJoinRules permissions={permissions} />
                <RoomPublish permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Addresses</Text>
                <RoomPublishedAddresses permissions={permissions} />
                <RoomLocalAddresses permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Advance Options</Text>
                <RoomUpgrade permissions={permissions} requestClose={requestClose} />
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
