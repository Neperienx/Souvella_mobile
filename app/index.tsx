import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

export default function Index() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return <Redirect href={session ? '/circles' : '/auth'} />;
}
