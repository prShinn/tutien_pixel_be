package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="spawn_monster")
public class spawnMonsterEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int mapCode;
    private int x;
    private int y;
    private int w;
    private int h;
    private int count;
    private int monsterCode;
}
