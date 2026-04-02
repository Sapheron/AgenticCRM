'use client';

import { useEffect, useState } from 'react';
import { getSocket } from './use-socket';

interface QrState {
  qrCode: string | null;
  connected: boolean;
  phoneNumber?: string;
  displayName?: string;
  status: 'idle' | 'pending' | 'connected' | 'error';
}

export function useWhatsAppQr(accountId: string | null) {
  const [state, setState] = useState<QrState>({ qrCode: null, connected: false, status: 'idle' });

  useEffect(() => {
    if (!accountId) return;
    const socket = getSocket();
    if (!socket) return;

    setState((s) => ({ ...s, status: 'pending' }));

    const handleQr = ({ accountId: aid, qrCode }: { accountId: string; qrCode: string }) => {
      if (aid !== accountId) return;
      setState({ qrCode, connected: false, status: 'pending' });
    };

    const handleConnected = ({
      accountId: aid,
      phoneNumber,
      displayName,
    }: { accountId: string; phoneNumber: string; displayName: string }) => {
      if (aid !== accountId) return;
      setState({ qrCode: null, connected: true, phoneNumber, displayName, status: 'connected' });
    };

    const handleDisconnected = ({ accountId: aid }: { accountId: string }) => {
      if (aid !== accountId) return;
      setState({ qrCode: null, connected: false, status: 'idle' });
    };

    socket.on('whatsapp.qr', handleQr);
    socket.on('whatsapp.connected', handleConnected);
    socket.on('whatsapp.disconnected', handleDisconnected);

    return () => {
      socket.off('whatsapp.qr', handleQr);
      socket.off('whatsapp.connected', handleConnected);
      socket.off('whatsapp.disconnected', handleDisconnected);
    };
  }, [accountId]);

  return state;
}
