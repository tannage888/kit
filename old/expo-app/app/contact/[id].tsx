import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { getContactById, getFollowUps, getInteractions, toggleFollowUp } from '@/lib/supabase';
import { Contact, FollowUp, InteractionLog } from '@/types';
import { formatDate, tierLabel, daysOverdue } from '@/lib/dateUtils';

const TIER_COLORS: Record<number, string> = {
  1: '#7c3aed',
  2: '#0e7490',
  3: '#374151',
};

export default function ContactDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();

  const [contact, setContact] = useState<Contact | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [interactions, setInteractions] = useState<InteractionLog[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      (async () => {
        const [c, fus, ints] = await Promise.all([
          getContactById(id),
          getFollowUps(id),
          getInteractions(id),
        ]);
        setContact(c);
        if (c) navigation.setOptions({ title: c.name });
        setFollowUps(fus);
        setInteractions(ints);
      })();
    }, [id])
  );

  if (!contact) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Contact not found.</Text>
      </View>
    );
  }

  const overdue = daysOverdue(contact.next_action);
  const isOverdue = overdue > 0;

  const openWhatsApp = async () => {
    let url: string;
    if (contact.whatsapp) {
      // Normalise: strip leading + and spaces
      const digits = contact.whatsapp.replace(/[^\d]/g, '');
      url = `https://wa.me/${digits}`;
    } else {
      url = 'whatsapp://';
    }
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('WhatsApp not available', 'Make sure WhatsApp is installed.');
    }
  };

  const handleToggleFollowUp = async (fu: FollowUp) => {
    const next = fu.completed !== 1;
    await toggleFollowUp(fu.id, next);
    setFollowUps(prev => prev.map(f => f.id === fu.id ? { ...f, completed: next ? 1 : 0 } : f));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.name}>{contact.name}</Text>
        <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[contact.tier] }]}>
          <Text style={styles.tierText}>{tierLabel(contact.tier)}</Text>
        </View>
      </View>

      {/* Meta */}
      <View style={styles.metaRow}>
        <MetaItem label="Frequency" value={contact.frequency} />
        <MetaItem label="Last contact" value={formatDate(contact.last_contact)} />
        <MetaItem label="Next action" value={formatDate(contact.next_action)} />
        {contact.social_battery_cost && (
          <MetaItem label="Energy cost" value={contact.social_battery_cost} />
        )}
      </View>

      {/* Due status */}
      <View style={[styles.dueChip, isOverdue ? styles.overdueChip : styles.upcomingChip]}>
        <Text style={[styles.dueChipText, isOverdue ? styles.overdueText : styles.upcomingText]}>
          {isOverdue
            ? `${overdue} day${overdue !== 1 ? 's' : ''} overdue`
            : overdue === 0
            ? 'Due today'
            : `Due in ${Math.abs(overdue)} day${Math.abs(overdue) !== 1 ? 's' : ''}`}
        </Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.whatsappBtn} onPress={openWhatsApp} activeOpacity={0.8}>
          <Text style={styles.whatsappBtnText}>Open WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.logBtn}
          onPress={() => router.push(`/log/${id}`)}
          activeOpacity={0.8}
        >
          <Text style={styles.logBtnText}>Log Interaction</Text>
        </TouchableOpacity>
      </View>

      {/* Origin story */}
      {contact.origin_story && (
        <Section title="Background">
          <Text style={styles.bodyText}>{contact.origin_story}</Text>
        </Section>
      )}

      {/* Notes */}
      {contact.notes && (
        <Section title="Notes">
          <Text style={styles.bodyText}>{contact.notes}</Text>
        </Section>
      )}

      {/* Follow-ups */}
      {followUps.length > 0 && (
        <Section title="Follow-ups">
          {followUps.map(fu => (
            <TouchableOpacity
              key={fu.id}
              style={styles.followUpRow}
              onPress={() => handleToggleFollowUp(fu)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, fu.completed === 1 && styles.checkboxDone]} />
              <Text style={[styles.followUpText, fu.completed === 1 && styles.followUpDone]}>
                {fu.text}
              </Text>
            </TouchableOpacity>
          ))}
        </Section>
      )}

      {/* Interaction log */}
      {interactions.length > 0 && (
        <Section title="Interaction Log">
          {interactions.map(i => (
            <View key={i.id} style={styles.logEntry}>
              <Text style={styles.logDate}>{formatDate(i.date)}</Text>
              <Text style={styles.logNotes}>{i.notes}</Text>
            </View>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 16, paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  name: { fontSize: 28, fontWeight: '800', color: '#ffffff', flex: 1 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tierText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metaItem: {
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    padding: 10,
    minWidth: '45%',
    flex: 1,
  },
  metaLabel: { fontSize: 10, color: '#6b7280', fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  metaValue: { fontSize: 14, color: '#e5e7eb', fontWeight: '600' },
  dueChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  overdueChip: { backgroundColor: '#3f1010' },
  upcomingChip: { backgroundColor: '#1a2a1a' },
  dueChipText: { fontSize: 13, fontWeight: '700' },
  overdueText: { color: '#ef4444' },
  upcomingText: { color: '#4ade80' },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  whatsappBtn: {
    flex: 1,
    backgroundColor: '#25d366',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  whatsappBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  logBtn: {
    flex: 1,
    backgroundColor: '#1e3a5f',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2563eb44',
  },
  logBtnText: { color: '#93c5fd', fontSize: 15, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#6b7280',
    marginBottom: 10,
  },
  bodyText: { color: '#d1d5db', fontSize: 14, lineHeight: 21 },
  followUpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4b5563',
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: '#4ade80', borderColor: '#4ade80' },
  followUpText: { color: '#e5e7eb', fontSize: 14, flex: 1, lineHeight: 20 },
  followUpDone: { color: '#4b5563', textDecorationLine: 'line-through' },
  logEntry: {
    borderLeftWidth: 2,
    borderLeftColor: '#374151',
    paddingLeft: 12,
    marginBottom: 16,
  },
  logDate: { fontSize: 12, color: '#6b7280', fontWeight: '600', marginBottom: 4 },
  logNotes: { color: '#d1d5db', fontSize: 14, lineHeight: 20 },
  emptyText: { color: '#6b7280', padding: 20 },
});
