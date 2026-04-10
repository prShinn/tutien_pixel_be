package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "shop")
public class shopEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String mapCode;
    private String mapName;
    private int x;
    private int y;
    private String listItem;
}
