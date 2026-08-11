/**
 * UpdateNotification — Version minimale pour le TUI HIVE-MIND.
 *
 * Le système de mise à jour automatique de HIVE-MIND TUI n'est pas applicable.
 * Ce composant retourne null en attendant une future implémentation HIVE-MIND.
 */

import React from 'react';

interface UpdateNotificationProps {
  message?: string;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = () => {
  return null;
};
