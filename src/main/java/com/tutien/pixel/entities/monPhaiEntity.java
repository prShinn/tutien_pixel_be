package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="monPhai")
public class monPhaiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
    private int soLuong;
    private int maxSoLuong;
    private int level;
    private int maxLevel;
    private String danhHieu;
    private String icon;
}
