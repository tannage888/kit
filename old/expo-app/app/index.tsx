import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getOverdueContacts, getDueThisWeek } from '@/lib/supabase';
import { Contact } from '@/types';
import { daysOverdue, formatDate, tierLabel } from '@/lib/dateUtils';

const TIER_COLORS: Record<number, string> = {
  1: '#7c3aed',
  2: '#0e7490',
  3: '#374151',
};

function ContactCard({
  contact,
  onPress,
}: {
  contact: Contact;
  onPress: () => void;
}) {
  const overdue = daysOverdue(contact.next_action);
  const isOverdue = overdue > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardRow}>
        <Text style={styles.cardName}>{contact.name}</Text>
        <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[contact.tier] ?? '#374151' }]}>
          <Text style={styles.tierText}>{tierLabel(contact.tier)}</Text>
        </View>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardFreq}>{contact.frequency}</Text>
        <Text style={[styles.cardDue, isOverdue ? styles.overdue : styles.upcoming]}>
          {isOverdue
            ? `${overdue}d overdue`
            : overdue === 0
            ? 'Due today'
            : `Due in ${Math.abs(overdue)}d`}
        </Text>
      </View>
      {contact.next_action && (
        <Text style={styles.cardDate}>Next: {formatDate(contact.next_action)}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [overdue, setOverdue] = useState<Contact[]>([]);
  const [dueWeek, setDueWeek] = useState<Contact[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [o, w] = await Promise.all([getOverdueContacts(), getDueThisWeek()]);
        setOverdue(o);
        setDueWeek(w);
      })();
    }, [])
  );

  const todaysOne = overdue[0] ?? null;
  const restOverdue = overdue.slice(1);

  const navigate = (id: string) => router.push(`/contact/${id}`);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>TODAY'S ONE THING</Text>
      {todaysOne ? (
        <TouchableOpacity
          style={styles.heroCard}
          onPress={() => navigate(todaysOne.id)}
          activeOpacity={0.8}
        >
          <Text style={styles.heroName}>{todaysOne.name}</Text>
          <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[todaysOne.tier] }]}>
            <Text style={styles.tierText}>{tierLabel(todaysOne.tier)}</Text>
          </View>
          <Text style={styles.heroSub}>{todaysOne.frequency} · {todaysOne.last_contact ? `Last: ${formatDate(todaysOne.last_contact)}` : 'Never contacted'}</Text>
          <Text style={styles.overdue}>
            {daysOverdue(todaysOne.next_action)}d overdue
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Nothing overdue — you're on top of it.</Text>
        </View>
      )}

      {restOverdue.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>ALSO OVERDUE</Text>
          {restOverdue.map(c => (
            <ContactCard key={c.id} contact={c} onPress={() => navigate(c.id)} />
          ))}
        </>
      )}

      {dueWeek.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>DUE THIS WEEK</Text>
          {dueWeek.map(c => (
            <ContactCard key={c.id} contact={c} onPress={() => navigate(c.id)} />
          ))}
        </>
      )}

      {overdue.length === 0 && dueWeek.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No contacts due in the next 7 days.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#6b7280',
    marginTop: 24,
    marginBottom: 10,
  },
  heroCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#7c3aed44',
    gap: 6,
  },
  heroName: { fontSize: 26, fontWeight: '800', color: '#ffffff' },
  heroSub: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardName: { fontSize: 16, fontWeight: '600', color: '#f3f4f6' },
  cardFreq: { fontSize: 12, color: '#6b7280' },
  cardDue: { fontSize: 12, fontWeight: '600' },
  cardDate: { fontSize: 11, color: '#4b5563', marginTop: 2 },
  overdue: { color: '#ef4444', fontWeight: '700' },
  upcoming: { color: '#6b7280' },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  tierText: { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  emptyCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { color: '#6b7280', fontSize: 14 },
});
