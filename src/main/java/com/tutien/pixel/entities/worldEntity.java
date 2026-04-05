package com.tutien.pixel.entities;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "worlds")
public class worldEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String tenMap;
    private String code;
    private String jsonMap;
    private int w;
    private int h;
    @OneToMany(mappedBy = "id", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<portalEntity> portals = new ArrayList<>();
    @OneToMany(mappedBy = "code", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<monsterEntity> monsters = new ArrayList<>();
}
