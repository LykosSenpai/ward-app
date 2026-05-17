do $$
declare
  legacy_table text;
  legacy_row_count bigint;
  legacy_tables text[] := array[
    'deck_cards',
    'lobby_players',
    'lobbies',
    'decks',
    'user_marketplace_needs',
    'user_marketplace_auto_need_rules'
  ];
begin
  foreach legacy_table in array legacy_tables loop
    if to_regclass(format('public.%I', legacy_table)) is not null then
      execute format('select count(*) from public.%I', legacy_table) into legacy_row_count;

      if legacy_row_count > 0 then
        raise exception 'Refusing to drop legacy table %, because it still contains % row(s). Back it up and migrate or clear the data first.',
          legacy_table,
          legacy_row_count;
      end if;
    end if;
  end loop;
end $$;

drop table if exists deck_cards;
drop table if exists lobby_players;
drop table if exists lobbies;
drop table if exists decks;
drop table if exists user_marketplace_needs;
drop table if exists user_marketplace_auto_need_rules;
