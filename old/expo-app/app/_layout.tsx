import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { isSeeded, markSeeded, seedContacts } from '@/lib/supabase';

let seedData: { contacts: any[]; followUps: any[]; interactions: any[] } | null = null;
try {
  seedData = require('../src/data/seedData.json');
} catch {
  // seedData.json not present — seed via `npm run seed` instead
}

export default function RootLayout() {
  useEffect(() => {
    (async () => {
      if (!seedData) return;
      const alreadySeeded = await isSeeded();
      if (!alreadySeeded) {
        await seedContacts(seedData.contacts, seedData.followUps, seedData.interactions);
        await markSeeded();
      }
    })();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0f0f0f' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0f0f0f' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Kit' }} />
        <Stack.Screen name="contact/[id]" options={{ title: '' }} />
        <Stack.Screen name="log/[id]" options={{ title: 'Log Interaction' }} />
      </Stack>
    </>
  );
}
