package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "npc")
public class npcEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
}
