import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getContactById, logInteraction } from '@/lib/supabase';
import { Contact } from '@/types';
import { today } from '@/lib/dateUtils';

export default function LogInteractionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getContactById(id).then(setContact);
  }, [id]);

  if (!contact) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Contact not found.</Text>
      </View>
    );
  }

  const handleSave = async () => {
    if (!notes.trim()) {
      Alert.alert('Nothing to log', 'Add a note about what you discussed.');
      return;
    }
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert('Invalid date', 'Date must be YYYY-MM-DD format.');
      return;
    }

    setSaving(true);
    try {
      await logInteraction(contact.id, contact.name, notes.trim(), date);
      router.back();
    } catch (err) {
      Alert.alert('Error', 'Failed to save interaction. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.contactName}>{contact.name}</Text>

        <Text style={styles.label}>DATE</Text>
        <TextInput
          style={styles.dateInput}
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#4b5563"
          keyboardType="numeric"
          maxLength={10}
        />

        <Text style={styles.label}>WHAT DID YOU DISCUSS?</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Quick summary of the conversation..."
          placeholderTextColor="#4b5563"
          multiline
          textAlignVertical="top"
          autoFocus
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Interaction'}</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Saves to Open Brain.{'\n'}
          Next action will be recalculated from today + {contact.frequency.toLowerCase()} frequency.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f0f0f' },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },
  contactName: { fontSize: 22, fontWeight: '700', color: '#ffffff', marginBottom: 24 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#6b7280',
    marginBottom: 8,
    marginTop: 16,
  },
  dateInput: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 14,
    color: '#f3f4f6',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2d2d2d',
  },
  notesInput: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 14,
    color: '#f3f4f6',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 160,
    borderWidth: 1,
    borderColor: '#2d2d2d',
  },
  saveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: {
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 16,
  },
  errorText: { color: '#ef4444', padding: 20 },
});
